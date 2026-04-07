// Claude Sessions API — Cloudflare Worker + D1
// Stores and retrieves Claude Code session transcripts.
// Auth: Bearer token (set AUTH_TOKEN below or via environment variable).

const AUTH_TOKEN = 'alpaca-sessions-2026';

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Auth check
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${AUTH_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(request.url);

    // POST /sessions — save a session
    if (request.method === 'POST' && url.pathname === '/sessions') {
      const body = await request.json();
      const id = body.id || crypto.randomUUID();

      await env.DB.prepare(`
        INSERT OR REPLACE INTO sessions (id, project, model, started_at, ended_at, duration_mins, summary, transcript, token_count, cost_usd, tags, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
        VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        body.project || null,
        body.model || null,
        body.started_at || null,
        body.ended_at || null,
        body.duration_mins || null,
        body.summary || null,
        body.transcript || null,
        body.token_count || null,
        body.cost_usd || null,
        body.tags || null,
        body.input_tokens || null,
        body.output_tokens || null,
        body.cache_read_tokens || null,
        body.cache_creation_tokens || null
      ).run();

      return json({ ok: true, id });
    }

    // GET /sessions — list sessions (sorted by started_at, falling back to ended_at)
    if (request.method === 'GET' && url.pathname === '/sessions') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const project = url.searchParams.get('project');
      const search = url.searchParams.get('search');
      const dateFrom = url.searchParams.get('from');
      const dateTo = url.searchParams.get('to');

      let query = 'SELECT id, project, model, started_at, ended_at, duration_mins, summary, token_count, cost_usd, tags, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens FROM sessions';
      let countQuery = 'SELECT COUNT(*) as total FROM sessions';
      const params = [];
      const countParams = [];
      const conditions = [];

      if (project && project !== 'all') {
        conditions.push('project = ?');
        params.push(project);
        countParams.push(project);
      }
      if (search) {
        conditions.push('(summary LIKE ? OR transcript LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
        countParams.push(`%${search}%`, `%${search}%`);
      }
      if (dateFrom) {
        conditions.push("COALESCE(started_at, ended_at) >= ?");
        params.push(dateFrom);
        countParams.push(dateFrom);
      }
      if (dateTo) {
        conditions.push("COALESCE(started_at, ended_at) <= ?");
        params.push(dateTo + ' 23:59:59');
        countParams.push(dateTo + ' 23:59:59');
      }

      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      query += where + ' ORDER BY COALESCE(started_at, ended_at) DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      countQuery += where;

      const [result, countResult] = await Promise.all([
        env.DB.prepare(query).bind(...params).all(),
        env.DB.prepare(countQuery).bind(...countParams).all()
      ]);
      const total = countResult.results[0]?.total || 0;
      return json({ sessions: result.results, count: result.results.length, total, limit, offset });
    }

    // GET /sessions/:id — get full session with transcript
    if (request.method === 'GET' && url.pathname.startsWith('/sessions/')) {
      const id = url.pathname.split('/sessions/')[1];
      const result = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
      if (!result) return json({ error: 'not found' }, 404);
      return json(result);
    }

    // POST /fix-timestamps — fix bulk-imported sessions with wrong ended_at
    // Sets ended_at = started_at + duration_mins for sessions where ended_at was the import time
    if (request.method === 'POST' && url.pathname === '/fix-timestamps') {
      const body = await request.json();
      const importTime = body.import_time || '2026-03-13 21:48:00';
      const importEnd = body.import_end || '2026-03-13 21:54:00';

      // For sessions with real duration: ended_at = started_at + duration
      const r1 = await env.DB.prepare(`
        UPDATE sessions
        SET ended_at = datetime(started_at, '+' || duration_mins || ' minutes')
        WHERE ended_at >= ? AND ended_at <= ?
          AND started_at IS NOT NULL
          AND duration_mins IS NOT NULL AND duration_mins > 0
      `).bind(importTime, importEnd).run();

      // For sessions without duration: set ended_at = started_at (midnight marker)
      const r2 = await env.DB.prepare(`
        UPDATE sessions
        SET ended_at = started_at
        WHERE ended_at >= ? AND ended_at <= ?
          AND started_at IS NOT NULL
          AND (duration_mins IS NULL OR duration_mins <= 0)
      `).bind(importTime, importEnd).run();

      return json({ ok: true, with_duration: r1.meta?.changes, without_duration: r2.meta?.changes });
    }

    // POST /fix-durations — backfill duration_mins from started_at/ended_at
    if (request.method === 'POST' && url.pathname === '/fix-durations') {
      const result = await env.DB.prepare(`
        UPDATE sessions
        SET duration_mins = MAX(1, CAST((julianday(ended_at) - julianday(started_at)) * 1440 AS INTEGER))
        WHERE duration_mins IS NULL
          AND started_at IS NOT NULL
          AND ended_at IS NOT NULL
          AND julianday(ended_at) >= julianday(started_at)
      `).run();
      return json({ ok: true, fixed: result.meta?.changes || 0 });
    }

    // POST /fix-bulk-import — null out bogus durations for bulk-imported sessions
    // whose ended_at was the import time, not the real session end
    if (request.method === 'POST' && url.pathname === '/fix-bulk-import') {
      // Step 1: Set ended_at = started_at and duration = NULL for sessions with unreasonable durations (>24h)
      const r1 = await env.DB.prepare(`
        UPDATE sessions
        SET ended_at = started_at, duration_mins = NULL
        WHERE duration_mins IS NOT NULL AND duration_mins >= 1440
          AND started_at IS NOT NULL
      `).run();
      return json({ ok: true, reset: r1.meta?.changes || 0 });
    }

    // GET /stats — aggregate stats (only count reasonable durations < 24h)
    // Optional ?project=<name> filter
    if (request.method === 'GET' && url.pathname === '/stats') {
      const project = url.searchParams.get('project');
      const where = project ? 'WHERE project = ?' : '';
      const stmt = env.DB.prepare(`
        SELECT
          COUNT(*) as total_sessions,
          SUM(token_count) as total_tokens,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          SUM(cache_read_tokens) as total_cache_read_tokens,
          SUM(cache_creation_tokens) as total_cache_creation_tokens,
          SUM(cost_usd) as total_cost,
          SUM(CASE WHEN duration_mins IS NOT NULL AND duration_mins < 1440 THEN duration_mins ELSE 0 END) as total_minutes,
          AVG(token_count) as avg_tokens,
          AVG(CASE WHEN duration_mins IS NOT NULL AND duration_mins < 1440 THEN duration_mins ELSE NULL END) as avg_duration
        FROM sessions ${where}
      `);
      const result = await (project ? stmt.bind(project) : stmt).first();
      return json(result);
    }

    // GET /projects — list distinct projects with session counts
    if (request.method === 'GET' && url.pathname === '/projects') {
      const result = await env.DB.prepare(`
        SELECT
          project,
          COUNT(*) as sessions,
          SUM(token_count) as tokens,
          SUM(cost_usd) as cost,
          MAX(COALESCE(started_at, ended_at)) as last_seen
        FROM sessions
        WHERE project IS NOT NULL
        GROUP BY project
        ORDER BY last_seen DESC
      `).all();
      return json({ projects: result.results });
    }

    return json({ error: 'not found' }, 404);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
