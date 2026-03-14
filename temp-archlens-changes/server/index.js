require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const cron      = require('node-cron');
const rateLimit = require('express-rate-limit');
const { initDB, getDB }  = require('./db/db');
const { syncWorkspace: leanixSync, getToken: leanixGetToken, discoverTypes: leanixDiscoverTypes, parseHost } = require('./services/leanix');
const { syncWorkspace: turboSync, getToken: turboGetToken, discoverTypes: turboDiscoverTypes, parseUrl: parseTurboUrl } = require('./services/turboea');
const { analyseVendors, getAIConfig } = require('./services/ai');
const { phase1Questions, phase2Questions, phase3Architecture, loadLandscape } = require('./services/architect');
const { resolveVendorIdentities, detectDuplicates, assessModernization, loadFullLandscape } = require('./services/resolution');

const app  = express();
const PORT = process.env.PORT || 3001;
// CORS: in development allow any localhost origin (CRA runs on :3000, server on :3001).
// In production the React build is served by Express itself so no cross-origin requests occur.
// Custom origins can be added via CORS_ORIGINS env var (comma-separated).
const EXTRA_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : [];
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / server-to-server calls (no Origin header)
    if (!origin) return cb(null, true);
    // Allow any localhost / 127.0.0.1 port in development
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    // Allow any explicitly configured extra origins
    if (EXTRA_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: ' + origin + ' not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Active cron tasks: scheduleId → task
const activeCrons = new Map();

// ── DB helpers ─────────────────────────────────────────────────────────────────
const INSERT_FS = `
  INSERT OR REPLACE INTO fact_sheets
  (id, workspace, fs_type, name, description, lifecycle, owner, owner_email,
   completion, updated_at, quality_score, locker, issues, tags, vendors,
   criticality, tech_fit, fs_level, annual_cost, synced_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
`;

async function persistItems(host, items) {
  const db = getDB();
  for (const it of items) {
    await db.run(INSERT_FS, [
      it.id, host, it.fs_type, it.name, it.description, it.lifecycle,
      it.owner, it.owner_email, it.completion, it.updated_at,
      it.quality_score, it.locker, it.issues, it.tags, it.vendors,
      it.criticality, it.tech_fit, it.fs_level, it.annual_cost
    ]);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO-CONNECT — restore saved workspace on app boot
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/connect/saved', async (req, res) => {
  try {
    const db = getDB();
    const ws = await db.get(
      `SELECT host, api_key, last_sync,
         (SELECT COUNT(*) FROM fact_sheets WHERE workspace=w.host) fs_count
       FROM workspaces w ORDER BY last_sync DESC LIMIT 1`
    );
    if (!ws || !ws.host || !ws.api_key || ws.fs_count === 0) {
      return res.json({ found: false });
    }
    // Verify the saved token still works (lightweight call)
    try {
      await getToken(ws.host, ws.api_key);
      res.json({ found: true, host: ws.host, lastSync: ws.last_sync, fsCount: ws.fs_count });
    } catch (_) {
      // Token expired/invalid — still return data so UI can show cached data
      res.json({ found: true, host: ws.host, lastSync: ws.last_sync, fsCount: ws.fs_count, tokenExpired: true });
    }
  } catch (e) {
    res.json({ found: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CONNECT
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/connect', async (req, res) => {
  const { workspace, apiKey, source_type, email, password } = req.body || {};

  // Turbo EA source: uses email/password auth
  if (source_type === 'turboea') {
    const url = workspace;
    if (!url || !email || !password) {
      return res.status(400).json({ error: 'workspace (URL), email, and password are required for Turbo EA' });
    }
    try {
      const { token, host } = await turboGetToken(url, email, password);
      const types = await turboDiscoverTypes(host, token);
      const db = getDB();
      const hostKey = parseTurboUrl(url);
      await db.run(`INSERT OR IGNORE INTO workspaces (host, api_key, source_type) VALUES (?, ?, ?)`, [hostKey, `turboea:${email}`, 'turboea']);
      await db.run(`UPDATE workspaces SET api_key = ?, source_type = ? WHERE host = ?`, [`turboea:${email}`, 'turboea', hostKey]);
      res.json({
        ok: true, host: hostKey, types, source_type: 'turboea',
        total: types.filter(t => t.count > 0).reduce((s, t) => s + t.count, 0)
      });
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
    return;
  }

  // Default: LeanIX source
  if (!workspace || !apiKey) return res.status(400).json({ error: 'workspace and apiKey are required' });
  try {
    const { token, host } = await leanixGetToken(workspace, apiKey);
    const types = await leanixDiscoverTypes(host, token);
    const db = getDB();
    await db.run(`INSERT OR IGNORE INTO workspaces (host, api_key) VALUES (?, ?)`, [host, apiKey]);
    await db.run(`UPDATE workspaces SET api_key = ? WHERE host = ?`, [apiKey, host]);
    res.json({
      ok: true, host, types, source_type: 'leanix',
      total: types.filter(t => t.count > 0).reduce((s, t) => s + t.count, 0)
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SYNC — Server-Sent Events live stream
//  POST accepts credentials in body (preferred); GET kept for backward compat.
// ═══════════════════════════════════════════════════════════════════════════════
function extractSyncParams(req) {
  if (req.method === 'POST') {
    // POST: credentials in body, non-sensitive params can be in query or body
    const merged = { ...req.query, ...req.body };
    return {
      workspace:   merged.workspace,
      apiKey:      merged.apiKey,
      fsTypes:     merged.fsTypes || 'all',
      source_type: merged.source_type,
      email:       merged.email,
      password:    merged.password,
    };
  }
  // GET: only allow non-sensitive params (workspace, fsTypes) from query string.
  // Credentials (apiKey, email, password) are NOT read from query params.
  return {
    workspace:   req.query.workspace,
    apiKey:      undefined,
    fsTypes:     req.query.fsTypes || 'all',
    source_type: undefined,
    email:       undefined,
    password:    undefined,
  };
}

async function handleSyncStream(req, res) {
  const { workspace, apiKey, fsTypes, source_type, email, password } = extractSyncParams(req);
  if (!workspace) return res.status(400).json({ error: 'workspace required' });

  // GET requests cannot carry credentials — require POST for authenticated sync
  if (req.method === 'GET' && !apiKey) {
    // Legacy GET path: look up stored API key from database for LeanIX compat
    const db = getDB();
    const row = await db.get('SELECT api_key, source_type FROM workspaces WHERE host = ?', [parseHost(workspace)]);
    if (!row || !row.api_key) return res.status(400).json({ error: 'Use POST with credentials in body' });
  }
  if (source_type !== 'turboea' && !apiKey) return res.status(400).json({ error: 'apiKey required for LeanIX sync — use POST with credentials in body' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = data => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  const db = getDB();
  let jobId;
  try {
    const jr = await db.run(
      `INSERT INTO sync_jobs (workspace, job_type, fs_types, status, started_at) VALUES (?, ?, ?, 'running', datetime('now'))`,
      [parseHost(workspace), fsTypes === 'all' ? 'full' : 'partial', fsTypes]
    );
    jobId = jr.lastInsertRowid;
  } catch { jobId = null; }

  try {
    let syncResult;
    if (source_type === 'turboea') {
      syncResult = await turboSync(workspace, email, password, { fsTypes }, send);
    } else {
      syncResult = await leanixSync(workspace, apiKey, { fsTypes }, send);
    }
    const { results, allTypes, host } = syncResult;

    send({ event: 'saving', msg: 'Persisting to database…' });
    let saved = 0;
    for (const [, items] of Object.entries(results)) {
      await persistItems(host, items);
      saved += items.length;
    }

    await db.run(`UPDATE workspaces SET last_sync = datetime('now') WHERE host = ?`, [host]);
    if (jobId) await db.run(
      `UPDATE sync_jobs SET status='done', finished_at=datetime('now'), records=? WHERE id=?`,
      [saved, jobId]
    );

    const all = Object.values(results).flat();
    send({ event: 'done', total: saved,
      bronze: all.filter(i => i.locker === 'bronze').length,
      silver: all.filter(i => i.locker === 'silver').length,
      gold:   all.filter(i => i.locker === 'gold').length,
      types: allTypes
    });
  } catch (err) {
    if (jobId) await db.run(
      `UPDATE sync_jobs SET status='error', finished_at=datetime('now'), error=? WHERE id=?`,
      [err.message, jobId]
    ).catch(() => {});
    send({ event: 'error', msg: err.message });
  }
  res.end();
}

// GET kept for backward compatibility (LeanIX); POST preferred for Turbo EA
app.get('/api/sync/stream', handleSyncStream);
app.post('/api/sync/stream', handleSyncStream);

// Sync job history
app.get('/api/sync/jobs', async (req, res) => {
  const db = getDB();
  const jobs = await db.all(
    `SELECT * FROM sync_jobs WHERE workspace = ? ORDER BY id DESC LIMIT 50`,
    [req.query.workspace || '']
  );
  res.json(jobs);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DATA — read from local DB
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/data/overview', async (req, res) => {
  const ws = req.query.workspace || '';
  const db = getDB();
  try {
    const [counts, issues, noOwner, topIssues, lastSyncRow, costByType] = await Promise.all([
      db.all(`SELECT fs_type, locker, COUNT(*) c FROM fact_sheets WHERE workspace=? GROUP BY fs_type, locker`, [ws]),
      db.all(`SELECT fs_type, COUNT(*) c FROM fact_sheets WHERE workspace=? AND issues LIKE '%"eol"%' GROUP BY fs_type`, [ws]),
      db.all(`SELECT fs_type, COUNT(*) c FROM fact_sheets WHERE workspace=? AND owner IS NULL GROUP BY fs_type`, [ws]),
      db.all(`SELECT id, fs_type, name, locker, quality_score, issues FROM fact_sheets WHERE workspace=? AND locker IN ('bronze','silver') ORDER BY quality_score ASC LIMIT 15`, [ws]),
      db.get(`SELECT last_sync FROM workspaces WHERE host=?`, [ws]),
      db.all(`SELECT fs_type, SUM(annual_cost) total FROM fact_sheets WHERE workspace=? AND annual_cost > 0 GROUP BY fs_type`, [ws])
    ]);

    const byType = {};
    const lockers = { bronze: 0, silver: 0, gold: 0 };
    for (const r of counts) {
      byType[r.fs_type] = (byType[r.fs_type] || 0) + r.c;
      lockers[r.locker] = (lockers[r.locker] || 0) + r.c;
    }

    res.json({
      byType, lockers,
      lastSync:    lastSyncRow?.last_sync,
      eol:         Object.fromEntries(issues.map(r  => [r.fs_type, r.c])),
      noOwner:     Object.fromEntries(noOwner.map(r => [r.fs_type, r.c])),
      costByType:  Object.fromEntries(costByType.map(r => [r.fs_type, r.total])),
      topIssues:   topIssues.map(r => ({ ...r, issues: JSON.parse(r.issues || '[]') }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/data/types', async (req, res) => {
  const db = getDB();
  const rows = await db.all(`
    SELECT fs_type,
      COUNT(*) total,
      SUM(CASE WHEN locker='bronze' THEN 1 ELSE 0 END) bronze,
      SUM(CASE WHEN locker='silver' THEN 1 ELSE 0 END) silver,
      SUM(CASE WHEN locker='gold'   THEN 1 ELSE 0 END) gold,
      SUM(annual_cost) total_cost,
      SUM(CASE WHEN owner IS NULL   THEN 1 ELSE 0 END) no_owner,
      SUM(CASE WHEN issues LIKE '%"eol"%' THEN 1 ELSE 0 END) eol_count
    FROM fact_sheets WHERE workspace=? GROUP BY fs_type ORDER BY total DESC`,
    [req.query.workspace || '']
  );
  res.json(rows);
});

app.get('/api/data/factsheets', async (req, res) => {
  const { workspace = '', fs_type = 'all', locker = 'bronze', page = 1, limit = 60, search = '' } = req.query;
  const db = getDB();
  const where = ['workspace=?'];
  const params = [workspace];
  if (fs_type !== 'all') { where.push('fs_type=?'); params.push(fs_type); }
  if (locker  !== 'all') { where.push('locker=?');  params.push(locker);  }
  if (search) {
    where.push('(name LIKE ? OR owner LIKE ? OR lifecycle LIKE ? OR description LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  const wh = 'WHERE ' + where.join(' AND ');
  const [cnt, rows] = await Promise.all([
    db.get(`SELECT COUNT(*) c FROM fact_sheets ${wh}`, params),
    db.all(
      `SELECT id, fs_type, name, description, lifecycle, owner, owner_email, completion,
              updated_at, quality_score, locker, issues, tags, vendors, criticality, tech_fit, fs_level, annual_cost
       FROM fact_sheets ${wh} ORDER BY quality_score ASC, name ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), (parseInt(page) - 1) * parseInt(limit)]
    )
  ]);
  res.json({
    total: cnt.c, page: parseInt(page),
    items: rows.map(r => ({
      ...r,
      issues:  JSON.parse(r.issues  || '[]'),
      tags:    JSON.parse(r.tags    || '[]'),
      vendors: JSON.parse(r.vendors || '[]')
    }))
  });
});

app.get('/api/data/export', async (req, res) => {
  const { workspace = '', locker, fs_type } = req.query;
  const db = getDB();
  const where = ['workspace=?'];
  const params = [workspace];
  if (locker  && locker  !== 'all') { where.push('locker=?');  params.push(locker);  }
  if (fs_type && fs_type !== 'all') { where.push('fs_type=?'); params.push(fs_type); }
  const rows = await db.all(
    `SELECT name, fs_type, lifecycle, owner, owner_email, quality_score, locker,
            completion, annual_cost, updated_at, criticality, tech_fit, fs_level, issues, tags, vendors
     FROM fact_sheets WHERE ${where.join(' AND ')} ORDER BY quality_score ASC`,
    params
  );
  const cols = ['name','fs_type','lifecycle','owner','owner_email','quality_score','locker','completion','annual_cost','updated_at','criticality','tech_fit','fs_level'];
  const csv = [
    cols.join(','),
    ...rows.map(r => cols.map(c => `"${(r[c] || '').toString().replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=archlens-${workspace}-export.csv`);
  res.send(csv);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  VENDORS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/vendors', async (req, res) => {
  const db = getDB();
  const rows = await db.all(
    `SELECT * FROM vendor_analysis WHERE workspace=? ORDER BY total_cost DESC, app_count DESC`,
    [req.query.workspace || '']
  );
  res.json(rows.map(r => ({ ...r, app_list: JSON.parse(r.app_list || '[]') })));
});

app.post('/api/vendors/analyse', async (req, res) => {
  try {
    const result = await analyseVendors(req.body.workspace);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SSE streaming version of vendor analysis
app.get('/api/vendors/analyse/stream', async (req, res) => {
  const { workspace } = req.query;
  if (!workspace) return res.status(400).json({ error: 'workspace required' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const emit = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  try {
    emit({ event: 'step', msg: 'Loading fact sheets from local database...' });
    const db = getDB();
    const apps = await db.all(
      `SELECT DISTINCT json_each.value AS vendor_name FROM fact_sheets, json_each(fact_sheets.vendors)
       WHERE workspace=? AND fs_type IN ('Application','ITComponent') AND vendors IS NOT NULL AND vendors != '[]'`,
      [workspace]
    ).catch(() => []);
    emit({ event: 'step', msg: `Found ${apps.length} vendor references — starting AI analysis...` });
    const result = await analyseVendors(workspace, (msg) => emit({ event: 'step', msg }));
    emit({ event: 'step', msg: `✓ Categorised ${result.analysed || 0} vendors into 16 categories` });
    emit({ event: 'complete', analysed: result.analysed || 0 });
  } catch (e) {
    emit({ event: 'error', msg: e.message });
  }
  res.end();
});

app.delete('/api/vendors', async (req, res) => {
  const db = getDB();
  await db.run(`DELETE FROM vendor_analysis WHERE workspace=?`, [req.query.workspace || '']);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/settings', async (req, res) => {
  const db = getDB();
  const rows = await db.all(`SELECT key, value FROM settings`).catch(() => []);
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // Mask sensitive fields
  if (s.ai_api_key && s.ai_api_key.length > 10) s.ai_api_key = s.ai_api_key.slice(0, 8) + '…';
  if (s.db_password) s.db_password = '••••••••';
  const { provider } = await getAIConfig().catch(() => ({ provider: 'claude' }));
  res.json({
    ...s,
    db_type_active: db.type || 'sqlite',
    db_conn: db.connStr || '',
    ai_provider_active: provider
  });
});

app.post('/api/settings', async (req, res) => {
  const db = getDB();
  for (const [k, v] of Object.entries(req.body || {})) {
    await db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [k, String(v)]);
    if (k === 'ai_provider' && v)                        process.env.AI_PROVIDER = v;
    if (k === 'ai_api_key'  && v && !v.includes('…'))   process.env.AI_API_KEY  = v;
  }
  res.json({ ok: true });
});

app.get('/api/settings/db-test', async (req, res) => {
  try {
    const db = getDB();
    await db.get('SELECT 1');
    const cnt = await db.get(`SELECT COUNT(*) c FROM fact_sheets`).catch(() => ({ c: 0 }));
    res.json({ ok: true, type: db.type || 'sqlite', records: cnt.c, conn: db.connStr || '' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  AI STATUS — lightweight check without making a real AI call
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/ai/status', async (req, res) => {
  try {
    const { provider, apiKey } = await getAIConfig();
    if (!apiKey) return res.json({ ok: false, reason: 'missing', provider });

    // Validate key format without making a real AI call
    let formatOk = false;
    if (provider === 'claude')   formatOk = /^sk-ant-api/.test(apiKey);
    if (provider === 'openai')   formatOk = /^sk-/.test(apiKey);
    if (provider === 'deepseek') formatOk = /^sk-/.test(apiKey);
    if (!formatOk && apiKey.includes('…')) {
      // Masked key from GET /api/settings — key is present, assume valid
      return res.json({ ok: true, provider, masked: true });
    }
    if (!formatOk) return res.json({ ok: false, reason: 'invalid_format', provider });

    return res.json({ ok: true, provider });
  } catch (e) {
    res.json({ ok: false, reason: 'error', error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CRON SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════════
async function executeCronJob(scheduleId, host, apiKey, fsTypes) {
  const db = getDB();
  let jobId;
  try {
    const jr = await db.run(
      `INSERT INTO sync_jobs (workspace, job_type, fs_types, status, started_at, triggered_by) VALUES (?,?,?,'running',datetime('now'),?)`,
      [host, 'scheduled', fsTypes, `cron:${scheduleId}`]
    );
    jobId = jr.lastInsertRowid;
    console.log(`[cron:${scheduleId}] starting sync (fsTypes=${fsTypes})`);

    const { results, host: h } = await syncWorkspace(host, apiKey, { fsTypes });
    let saved = 0;
    for (const [, items] of Object.entries(results)) {
      await persistItems(h, items);
      saved += items.length;
    }
    await db.run(`UPDATE workspaces SET last_sync=datetime('now') WHERE host=?`, [h]);
    await db.run(`UPDATE sync_jobs SET status='done', finished_at=datetime('now'), records=? WHERE id=?`, [saved, jobId]);
    await db.run(`UPDATE cron_schedules SET last_run=datetime('now') WHERE id=?`, [scheduleId]);
    console.log(`[cron:${scheduleId}] done — ${saved} records`);
  } catch (err) {
    console.error(`[cron:${scheduleId}] failed:`, err.message);
    if (jobId) await db.run(`UPDATE sync_jobs SET status='error', finished_at=datetime('now'), error=? WHERE id=?`, [err.message, jobId]).catch(() => {});
  }
}

async function loadCronSchedules() {
  const db = getDB();
  const schedules = await db.all(
    `SELECT cs.*, w.api_key FROM cron_schedules cs JOIN workspaces w ON cs.workspace = w.host WHERE cs.enabled = 1`
  ).catch(() => []);

  for (const s of schedules) {
    if (!cron.validate(s.cron_expr)) { console.warn(`[cron] Invalid expr for schedule ${s.id}: ${s.cron_expr}`); continue; }
    const task = cron.schedule(s.cron_expr, () => executeCronJob(s.id, s.workspace, s.api_key, s.fs_types));
    activeCrons.set(s.id, task);
  }
  console.log(`[cron] ${schedules.length} schedule(s) loaded`);
}

// CRUD
app.get('/api/cron', async (req, res) => {
  const db = getDB();
  const rows = await db.all(`
    SELECT cs.*,
      (SELECT COUNT(*) FROM sync_jobs WHERE triggered_by = 'cron:' || cs.id) runs,
      (SELECT MAX(started_at) FROM sync_jobs WHERE triggered_by = 'cron:' || cs.id AND status='done') last_success
    FROM cron_schedules cs WHERE cs.workspace = ? ORDER BY cs.id DESC`,
    [req.query.workspace || '']
  );
  res.json(rows);
});

app.post('/api/cron', async (req, res) => {
  const { workspace, label, cron_expr, fs_types = 'all', job_type = 'full' } = req.body || {};
  if (!cron.validate(cron_expr)) return res.status(400).json({ error: `Invalid cron expression: "${cron_expr}"` });
  const db = getDB();
  const r = await db.run(
    `INSERT INTO cron_schedules (workspace, label, cron_expr, fs_types, job_type) VALUES (?,?,?,?,?)`,
    [workspace, label || cron_expr, cron_expr, fs_types, job_type]
  );
  const sid = r.lastInsertRowid;
  const ws  = await db.get(`SELECT api_key FROM workspaces WHERE host=?`, [workspace]);
  if (ws?.api_key) {
    const task = cron.schedule(cron_expr, () => executeCronJob(sid, workspace, ws.api_key, fs_types));
    activeCrons.set(sid, task);
  }
  res.json({ id: sid, label, cron_expr, fs_types, job_type });
});

app.put('/api/cron/:id/toggle', async (req, res) => {
  const db = getDB();
  const s = await db.get(`SELECT * FROM cron_schedules WHERE id=?`, [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  const enabled = s.enabled ? 0 : 1;
  await db.run(`UPDATE cron_schedules SET enabled=? WHERE id=?`, [enabled, s.id]);
  const task = activeCrons.get(s.id);
  if (task) enabled ? task.start() : task.stop();
  res.json({ enabled });
});

app.post('/api/cron/:id/run-now', async (req, res) => {
  const db = getDB();
  const s = await db.get(
    `SELECT cs.*, w.api_key FROM cron_schedules cs JOIN workspaces w ON cs.workspace=w.host WHERE cs.id=?`,
    [req.params.id]
  );
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  executeCronJob(s.id, s.workspace, s.api_key, s.fs_types); // fire-and-forget
  res.json({ ok: true, message: 'Job started' });
});

app.delete('/api/cron/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const task = activeCrons.get(id);
  if (task) { task.stop(); activeCrons.delete(id); }
  await getDB().run(`DELETE FROM cron_schedules WHERE id=?`, [id]);
  res.json({ ok: true });
});



// ═══════════════════════════════════════════════════════════════════════════════
//  VENDOR IDENTITY RESOLUTION  (SSE streaming)
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/resolution/stream', async (req, res) => {
  const { workspace } = req.query;
  if (!workspace) return res.status(400).json({ error: 'workspace required' });
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
  res.flushHeaders();
  const emit = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  try {
    await resolveVendorIdentities(workspace, emit);
    res.write(`data: ${JSON.stringify({ event:'complete' })}\n\n`);
  } catch(e) {
    res.write(`data: ${JSON.stringify({ event:'error', msg:e.message })}\n\n`);
  }
  res.end();
});

app.get('/api/resolution/hierarchy', async (req, res) => {
  const db = getDB();
  const rows = await db.all(
    `SELECT * FROM vendor_hierarchy WHERE workspace=? ORDER BY app_count+itc_count DESC`,
    [req.query.workspace || '']
  ).catch(() => []);
  res.json(rows);
});

app.delete('/api/resolution/hierarchy', async (req, res) => {
  await getDB().run(`DELETE FROM vendor_hierarchy WHERE workspace=?`, [req.query.workspace||'']);
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DUPLICATE DETECTION  (SSE streaming)
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/duplicates/stream', async (req, res) => {
  const { workspace, fsTypes } = req.query;
  if (!workspace) return res.status(400).json({ error: 'workspace required' });
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
  res.flushHeaders();
  const emit = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const types = fsTypes ? fsTypes.split(',') : ['Application','ITComponent','Interface'];
  try {
    await detectDuplicates(workspace, types, emit);
    res.write(`data: ${JSON.stringify({ event:'complete' })}\n\n`);
  } catch(e) {
    res.write(`data: ${JSON.stringify({ event:'error', msg:e.message })}\n\n`);
  }
  res.end();
});

app.get('/api/duplicates', async (req, res) => {
  const db = getDB();
  const rows = await db.all(
    `SELECT * FROM duplicate_clusters WHERE workspace=? ORDER BY id DESC`,
    [req.query.workspace || '']
  ).catch(() => []);
  res.json(rows);
});

app.put('/api/duplicates/:id/status', async (req, res) => {
  const { status } = req.body || {};
  await getDB().run(`UPDATE duplicate_clusters SET status=?,reviewed_at=datetime('now') WHERE id=?`, [status, req.params.id]);
  res.json({ ok:true });
});

app.delete('/api/duplicates', async (req, res) => {
  await getDB().run(`DELETE FROM duplicate_clusters WHERE workspace=?`, [req.query.workspace||'']);
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MODERNIZATION ASSESSMENT  (SSE streaming)
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/modernization/stream', async (req, res) => {
  const { workspace, targetType, modernizationType } = req.query;
  if (!workspace||!targetType) return res.status(400).json({ error:'workspace and targetType required' });
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
  res.flushHeaders();
  const emit = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  try {
    await assessModernization(workspace, targetType, modernizationType||'General', emit);
    res.write(`data: ${JSON.stringify({ event:'complete' })}\n\n`);
  } catch(e) {
    res.write(`data: ${JSON.stringify({ event:'error', msg:e.message })}\n\n`);
  }
  res.end();
});

app.get('/api/modernization', async (req, res) => {
  const db = getDB();
  const q = `SELECT * FROM modernization_assessments WHERE workspace=?${req.query.targetType?' AND target_type=?':''}  ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, effort`;
  const params = req.query.targetType ? [req.query.workspace||'', req.query.targetType] : [req.query.workspace||''];
  const rows = await db.all(q, params).catch(() => []);
  res.json(rows);
});

app.put('/api/modernization/:id/status', async (req, res) => {
  const { status } = req.body || {};
  await getDB().run(`UPDATE modernization_assessments SET status=? WHERE id=?`, [status, req.params.id]);
  res.json({ ok:true });
});

app.delete('/api/modernization', async (req, res) => {
  const params = [req.query.workspace||''];
  let q = `DELETE FROM modernization_assessments WHERE workspace=?`;
  if (req.query.targetType) { q += ' AND target_type=?'; params.push(req.query.targetType); }
  await getDB().run(q, params);
  res.json({ ok:true });
});
// ═══════════════════════════════════════════════════════════════════════════════
//  ARCHITECTURE INTELLIGENCE — 3-Phase conversational diagram builder
// ═══════════════════════════════════════════════════════════════════════════════

// Load vendor landscape context for a workspace
app.get('/api/architect/landscape', async (req, res) => {
  const { workspace } = req.query;
  if (!workspace) return res.status(400).json({ error: 'workspace required' });
  try {
    const landscape = await loadLandscape(workspace);
    res.json({
      vendorCount:  landscape.vendorCount,
      appCount:     landscape.appCount,
      totalTechFS:  landscape.totalTechFS,
      categories:   Object.keys(landscape.byCategory),
      topVendors:   landscape.vendors.slice(0, 20).map(v => ({ name: v.vendor_name, category: v.category }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Phase 1 — initial requirement → clarifying questions
app.post('/api/architect/phase1', async (req, res) => {
  const { workspace, requirement } = req.body || {};
  if (!workspace || !requirement) return res.status(400).json({ error: 'workspace and requirement required' });
  try {
    const landscape = await loadLandscape(workspace);
    const result    = await phase1Questions(requirement, landscape);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Phase 2 — phase1 answers → deeper technical questions
app.post('/api/architect/phase2', async (req, res) => {
  const { workspace, requirement, phase1QA } = req.body || {};
  if (!workspace || !requirement || !phase1QA) return res.status(400).json({ error: 'workspace, requirement and phase1QA required' });
  try {
    const landscape = await loadLandscape(workspace);
    const result    = await phase2Questions(requirement, phase1QA, landscape);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Phase 3 — all answers → full architecture + Mermaid diagram
app.post('/api/architect/phase3', async (req, res) => {
  const { workspace, requirement, allQA } = req.body || {};
  if (!workspace || !requirement || !allQA) return res.status(400).json({ error: 'workspace, requirement and allQA required' });
  try {
    const landscape = await loadLandscape(workspace);
    const result    = await phase3Architecture(requirement, allQA, landscape);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
//  MISC
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (_, res) => res.json({
  ok:      true,
  db:      getDB().type || 'sqlite',
  version: require('../package.json').version,
  uptime:  Math.floor(process.uptime()),
}));

// ── Production static file serving ─────────────────────────────────────────────
// When NODE_ENV=production, Express serves the React build from client/build/.
// In development, the CRA dev server handles the React side.
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const buildPath = path.join(__dirname, '..', 'client', 'build');
  app.use(express.static(buildPath, { maxAge: '1y', etag: true }));

  // Rate-limiting middleware for SPA fallback (100 req/min per IP)
  const spaLimiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  });

  // SPA fallback — any non-API route returns index.html
  app.get('*', spaLimiter, (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

app.get('/api/workspaces', async (_, res) => {
  const db = getDB();
  const rows = await db.all(
    `SELECT host, last_sync,
       (SELECT COUNT(*) FROM fact_sheets WHERE workspace=w.host) fs_count
     FROM workspaces w ORDER BY last_sync DESC`
  ).catch(() => []);
  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════
async function boot() {
  console.log('\n ╔═══════════════════════════════════╗');
  console.log(' ║     ArchLens v3 — Starting        ║');
  console.log(' ╚═══════════════════════════════════╝\n');
  await initDB();
  await loadCronSchedules();
  const HOST = process.env.HOST || '0.0.0.0';
  app.listen(PORT, HOST, () => {
    const isProd = process.env.NODE_ENV === 'production';
    console.log(`\n ✅  ArchLens ready`);
    console.log(` ✅  URL    →  http://localhost:${PORT}`);
    if (isProd) console.log(` ✅  Mode   →  production (serving React build)`);
    else        console.log(` ✅  Mode   →  development (React on :3000)`);
    console.log(` ✅  DB     →  ${getDB().type}`);
    console.log('');
  });
}

boot().catch(err => { console.error('Fatal boot error:', err); process.exit(1); });
