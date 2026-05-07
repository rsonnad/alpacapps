// testel — Tesla telemetry Worker
// Routes:
//   POST /snapshots  — insert one snapshot row (called by tesla-poller on Hostinger)
//   GET  /history    — return rows; query params: vehicle_id (req), since, until, limit
// Auth: both endpoints require Authorization: Bearer <SHARED_SECRET>

const SNAPSHOT_COLS = [
  'vehicle_id', 'recorded_at', 'vehicle_state', 'battery_level', 'battery_range_mi',
  'charging_state', 'charge_limit_soc', 'charge_rate_mph', 'charger_power_kw',
  'odometer_mi', 'inside_temp_f', 'outside_temp_f', 'climate_on', 'locked', 'sentry_mode',
  'latitude', 'longitude', 'speed_mph', 'heading', 'software_version',
  'tpms_fl_psi', 'tpms_fr_psi', 'tpms_rl_psi', 'tpms_rr_psi',
  'doors_open', 'windows_open', 'full_state',
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

function authed(req, env) {
  const h = req.headers.get('authorization') || '';
  const want = `Bearer ${env.SHARED_SECRET}`;
  return h === want;
}

async function handlePost(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  if (typeof body.vehicle_id !== 'number') return json({ error: 'vehicle_id required (number)' }, 400);

  const cols = [];
  const placeholders = [];
  const params = [];
  for (const c of SNAPSHOT_COLS) {
    if (c in body) {
      cols.push(c);
      placeholders.push('?');
      let v = body[c];
      if (v && typeof v === 'object') v = JSON.stringify(v);
      params.push(v ?? null);
    }
  }
  if (!cols.includes('recorded_at')) {
    cols.push('recorded_at');
    placeholders.push('?');
    params.push(new Date().toISOString());
  }

  const sql = `INSERT INTO tesla_vehicle_snapshots (${cols.join(',')}) VALUES (${placeholders.join(',')})`;
  try {
    const result = await env.DB.prepare(sql).bind(...params).run();
    return json({ ok: true, id: result.meta.last_row_id });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

async function handleGet(req, env) {
  const url = new URL(req.url);
  const vehicleId = url.searchParams.get('vehicle_id');
  if (!vehicleId) return json({ error: 'vehicle_id query param required' }, 400);

  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 5000);

  let sql = 'SELECT * FROM tesla_vehicle_snapshots WHERE vehicle_id = ?';
  const params = [parseInt(vehicleId)];
  if (since) { sql += ' AND recorded_at >= ?'; params.push(since); }
  if (until) { sql += ' AND recorded_at <= ?'; params.push(until); }
  sql += ' ORDER BY recorded_at DESC LIMIT ?';
  params.push(limit);

  try {
    const result = await env.DB.prepare(sql).bind(...params).all();
    return json({ ok: true, count: result.results.length, results: result.results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type',
        },
      });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'testel' });
    }

    if (!authed(req, env)) return json({ error: 'unauthorized' }, 401);

    if (url.pathname === '/snapshots' && req.method === 'POST') return handlePost(req, env);
    if (url.pathname === '/history' && req.method === 'GET') return handleGet(req, env);

    return json({ error: 'not found' }, 404);
  },
};
