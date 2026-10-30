"""Durable jobs claimed by the actual desktop agent through a local MCP tool."""
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager


class TaskError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class TaskQueue:
    def __init__(self, root):
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = root/'desktop-tasks.sqlite3'
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY, dedupe TEXT UNIQUE, digest TEXT NOT NULL,
                    payload TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL,
                    updated REAL NOT NULL, worker_id TEXT, claim_token TEXT,
                    response TEXT, error TEXT, detail TEXT);
                CREATE TABLE IF NOT EXISTS workers (
                    id TEXT PRIMARY KEY, seen REAL NOT NULL, waiting INTEGER NOT NULL);
            ''')
        self.path.chmod(0o600)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def accept(self, payload, dedupe):
        encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'))
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        now = time.time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if dedupe:
                old = db.execute('SELECT id,digest FROM tasks WHERE dedupe=?', (dedupe,)).fetchone()
                if old:
                    if old['digest'] != digest:
                        raise TaskError(409, 'Idempotency key already used for different content')
                    return old['id'], False
            if db.execute("SELECT count(*) FROM tasks WHERE status IN ('queued','processing','needs_approval')").fetchone()[0]>=25:
                raise TaskError(429, 'Desktop queue full')
            if db.execute('SELECT count(*) FROM tasks WHERE created>?', (now-3600,)).fetchone()[0]>=60:
                raise TaskError(429, 'Desktop hourly limit reached')
            tid = str(uuid.uuid4())
            db.execute('INSERT INTO tasks (id,dedupe,digest,payload,status,created,updated) VALUES (?,?,?,?,?,?,?)', (tid,dedupe,digest,encoded,'queued',now,now))
            return tid, True

    def get(self, tid):
        with self.db() as db:
            r = db.execute('SELECT * FROM tasks WHERE id=?', (tid,)).fetchone()
        if not r:
            return None
        d = {k:r[k] for k in ['id','status','created','updated','worker_id','response','error','detail']}
        d['task'] = json.loads(r['payload'])
        return d

    def heartbeat(self, worker, waiting):
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO workers VALUES (?,?,?)', (worker,time.time(),int(waiting)))

    def health(self):
        with self.db() as db:
            workers = [dict(r) for r in db.execute('SELECT * FROM workers WHERE seen>?', (time.time()-90,))]
            counts = {r['status']:r['n'] for r in db.execute('SELECT status,count(*) n FROM tasks GROUP BY status')}
        return {'workers':workers, 'counts':counts}

    def claim(self, worker):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            # One desktop is shared by all apps: never issue concurrent UI jobs.
            if db.execute("SELECT 1 FROM tasks WHERE status IN ('processing','needs_approval') LIMIT 1").fetchone():
                return None
            row = db.execute("SELECT * FROM tasks WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return None
            token = secrets.token_urlsafe(32)
            db.execute("UPDATE tasks SET status='processing',worker_id=?,claim_token=?,updated=? WHERE id=?", (worker,token,time.time(),row['id']))
            return {'id':row['id'], 'claim_token':token, 'task':json.loads(row['payload'])}

    def _owned(self, db, tid, token):
        r = db.execute('SELECT claim_token,status FROM tasks WHERE id=?', (tid,)).fetchone()
        if not r or not r['claim_token'] or not hmac.compare_digest(r['claim_token'],token):
            raise TaskError(403, 'Invalid task claim')
        return r

    def update(self, tid, token, status, detail):
        if status not in {'processing','needs_approval'}:
            raise TaskError(400, 'Invalid progress status')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            r = self._owned(db,tid,token)
            if r['status'] not in {'processing','needs_approval'}:
                raise TaskError(409, 'Task already finished')
            db.execute('UPDATE tasks SET status=?,detail=?,updated=? WHERE id=?', (status,detail,time.time(),tid))

    def finish(self, tid, token, response, error=None):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            r = self._owned(db,tid,token)
            target = 'failed' if error else 'completed'
            if r['status'] in {'completed','failed'}:
                old = db.execute('SELECT response,error FROM tasks WHERE id=?', (tid,)).fetchone()
                if old['response'] != response or old['error'] != error:
                    raise TaskError(409, 'Task already finished with a different result')
                return
            db.execute('UPDATE tasks SET status=?,response=?,error=?,updated=? WHERE id=?', (target,response,error,time.time(),tid))
