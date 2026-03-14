require('dotenv').config();
const path = require('path');
let _db = null;

// ── SQLite ─────────────────────────────────────────────────────────────────────
function makeSQLite(dbPath) {
  const Database = require('better-sqlite3');
  // In Docker the data directory is a mounted volume at /app/data
  // Outside Docker it defaults to ./archlens.db in the project root
  const defaultPath = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'archlens.db')
    : path.join(process.cwd(), 'archlens.db');
  const resolved = dbPath || process.env.DB_PATH || defaultPath;
  const sq = new Database(resolved);
  sq.pragma('journal_mode = WAL');
  sq.pragma('synchronous = NORMAL');
  console.log(`[DB] SQLite → ${resolved}`);
  return {
    type: 'sqlite',
    connStr: resolved,
    run:  (sql, p=[]) => Promise.resolve(sq.prepare(sql).run(...p)),
    all:  (sql, p=[]) => Promise.resolve(sq.prepare(sql).all(...p)),
    get:  (sql, p=[]) => Promise.resolve(sq.prepare(sql).get(...p) || null),
    exec: (sql)       => Promise.resolve(sq.exec(sql))
  };
}

// ── MySQL ──────────────────────────────────────────────────────────────────────
async function makeMySQL(cfg) {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host||'localhost', port: parseInt(cfg.port||3306),
    user: cfg.user||'archlens',  password: cfg.password||'',
    database: cfg.database||'archlens',
    waitForConnections: true, connectionLimit: 10
  });
  await pool.execute('SELECT 1'); // test
  console.log(`[DB] MySQL → ${cfg.host}/${cfg.database}`);
  const adapt = s => s
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'INT AUTO_INCREMENT PRIMARY KEY')
    .replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()')
    .replace(/INSERT OR REPLACE/gi, 'REPLACE')
    .replace(/INSERT OR IGNORE/gi,  'INSERT IGNORE')
    .replace(/\bREAL\b/g, 'DOUBLE');
  return {
    type: 'mysql',
    connStr: `${cfg.user}@${cfg.host}/${cfg.database}`,
    run:  async (sql, p=[]) => { const [r] = await pool.execute(adapt(sql), p); return { lastInsertRowid: r.insertId, changes: r.affectedRows }; },
    all:  async (sql, p=[]) => { const [r] = await pool.execute(adapt(sql), p); return r; },
    get:  async (sql, p=[]) => { const [r] = await pool.execute(adapt(sql), p); return r[0] || null; },
    exec: async (sql)       => { for (const q of sql.split(';').map(s=>s.trim()).filter(Boolean)) await pool.execute(adapt(q)).catch(()=>{}); }
  };
}

// ── PostgreSQL ─────────────────────────────────────────────────────────────────
async function makePostgres(cfg) {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: cfg.host||'localhost', port: parseInt(cfg.port||5432),
    user: cfg.user||'archlens',  password: cfg.password||'',
    database: cfg.database||'archlens'
  });
  await pool.query('SELECT 1');
  console.log(`[DB] PostgreSQL → ${cfg.host}/${cfg.database}`);
  let ph = 0;
  const adapt = s => {
    ph = 0;
    return s.replace(/\?/g, () => `$${++ph}`)
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
      .replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()')
      .replace(/INSERT OR REPLACE INTO\s+(\w+)/gi, 'INSERT INTO $1')
      .replace(/INSERT OR IGNORE INTO\s+(\w+)/gi, 'INSERT INTO $1');
  };
  return {
    type: 'postgres',
    connStr: `${cfg.user}@${cfg.host}/${cfg.database}`,
    run:  async (sql, p=[]) => { const r = await pool.query(adapt(sql), p); return { lastInsertRowid: r.rows[0]?.id, changes: r.rowCount }; },
    all:  async (sql, p=[]) => (await pool.query(adapt(sql), p)).rows,
    get:  async (sql, p=[]) => (await pool.query(adapt(sql), p)).rows[0] || null,
    exec: async (sql)       => pool.query(sql)
  };
}

// ── Schema ─────────────────────────────────────────────────────────────────────
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS workspaces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host        TEXT    UNIQUE NOT NULL,
  api_key     TEXT    NOT NULL,
  source_type TEXT    DEFAULT 'leanix',
  last_sync   TEXT,
  created_at  TEXT    DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fact_sheets (
  id            TEXT NOT NULL,
  workspace     TEXT NOT NULL,
  fs_type       TEXT NOT NULL,
  name          TEXT,
  description   TEXT,
  lifecycle     TEXT,
  owner         TEXT,
  owner_email   TEXT,
  completion    REAL    DEFAULT 0,
  updated_at    TEXT,
  quality_score INTEGER DEFAULT 0,
  locker        TEXT    DEFAULT 'bronze',
  issues        TEXT    DEFAULT '[]',
  tags          TEXT    DEFAULT '[]',
  vendors       TEXT    DEFAULT '[]',
  criticality   TEXT,
  tech_fit      TEXT,
  fs_level      TEXT,
  annual_cost   REAL    DEFAULT 0,
  synced_at     TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (id, workspace)
);
CREATE TABLE IF NOT EXISTS vendor_analysis (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace    TEXT NOT NULL,
  vendor_name  TEXT NOT NULL,
  category     TEXT,
  sub_category TEXT,
  reasoning    TEXT,
  app_count    INTEGER DEFAULT 0,
  total_cost   REAL    DEFAULT 0,
  app_list     TEXT    DEFAULT '[]',
  analysed_at  TEXT,
  UNIQUE(workspace, vendor_name)
);
CREATE TABLE IF NOT EXISTS sync_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace    TEXT NOT NULL,
  job_type     TEXT DEFAULT 'full',
  fs_types     TEXT DEFAULT 'all',
  status       TEXT DEFAULT 'pending',
  started_at   TEXT,
  finished_at  TEXT,
  records      INTEGER DEFAULT 0,
  error        TEXT,
  triggered_by TEXT DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS cron_schedules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace  TEXT NOT NULL,
  label      TEXT,
  cron_expr  TEXT NOT NULL,
  fs_types   TEXT DEFAULT 'all',
  job_type   TEXT DEFAULT 'full',
  enabled    INTEGER DEFAULT 1,
  last_run   TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fs_ws     ON fact_sheets(workspace);
CREATE INDEX IF NOT EXISTS idx_fs_type   ON fact_sheets(workspace, fs_type);
CREATE INDEX IF NOT EXISTS idx_fs_locker ON fact_sheets(workspace, locker);
CREATE INDEX IF NOT EXISTS idx_vend_ws   ON vendor_analysis(workspace);

CREATE TABLE IF NOT EXISTS vendor_hierarchy (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace     TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  vendor_type   TEXT DEFAULT 'vendor',
  parent_id     INTEGER,
  aliases       TEXT DEFAULT '[]',
  category      TEXT,
  sub_category  TEXT,
  description   TEXT,
  app_count     INTEGER DEFAULT 0,
  itc_count     INTEGER DEFAULT 0,
  total_cost    REAL DEFAULT 0,
  linked_fs     TEXT DEFAULT '[]',
  confidence    REAL DEFAULT 1.0,
  analysed_at   TEXT,
  UNIQUE(workspace, canonical_name)
);
CREATE TABLE IF NOT EXISTS duplicate_clusters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace     TEXT NOT NULL,
  cluster_name  TEXT NOT NULL,
  fs_type       TEXT NOT NULL,
  functional_domain TEXT,
  fs_ids        TEXT DEFAULT '[]',
  fs_names      TEXT DEFAULT '[]',
  evidence      TEXT,
  recommendation TEXT,
  status        TEXT DEFAULT 'pending',
  reviewed_at   TEXT,
  analysed_at   TEXT
);
CREATE TABLE IF NOT EXISTS modernization_assessments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  cluster_id    INTEGER,
  fs_id         TEXT,
  fs_name       TEXT,
  current_tech  TEXT,
  modernization_type TEXT,
  recommendation TEXT,
  effort        TEXT,
  priority      TEXT DEFAULT 'medium',
  status        TEXT DEFAULT 'pending',
  analysed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_vh_ws     ON vendor_hierarchy(workspace);
CREATE INDEX IF NOT EXISTS idx_dc_ws     ON duplicate_clusters(workspace);
CREATE INDEX IF NOT EXISTS idx_ma_ws     ON modernization_assessments(workspace);
`;

// ── Init ───────────────────────────────────────────────────────────────────────
async function initDB(overrideCfg) {
  const cfg = overrideCfg || {};
  const type = (cfg.type || process.env.DB_TYPE || 'sqlite').toLowerCase();

  try {
    if (type === 'mysql') {
      _db = await makeMySQL({
        host:     cfg.host     || process.env.MYSQL_HOST,
        port:     cfg.port     || process.env.MYSQL_PORT,
        user:     cfg.user     || process.env.MYSQL_USER,
        password: cfg.password || process.env.MYSQL_PASSWORD,
        database: cfg.database || process.env.MYSQL_DATABASE
      });
    } else if (type === 'postgres') {
      _db = await makePostgres({
        host:     cfg.host     || process.env.PG_HOST,
        port:     cfg.port     || process.env.PG_PORT,
        user:     cfg.user     || process.env.PG_USER,
        password: cfg.password || process.env.PG_PASSWORD,
        database: cfg.database || process.env.PG_DATABASE
      });
    } else {
      _db = makeSQLite(cfg.path || process.env.DB_PATH);
    }
  } catch (err) {
    console.warn(`[DB] ${type} failed (${err.message}) → falling back to SQLite`);
    _db = makeSQLite();
  }

  await _db.exec(SCHEMA);

  // Migrate: add source_type column if missing (existing DBs pre-date this column)
  try {
    await _db.run("ALTER TABLE workspaces ADD COLUMN source_type TEXT DEFAULT 'leanix'");
    console.log('[DB] Migrated: added workspaces.source_type');
  } catch (_) { /* column already exists */ }

  console.log('[DB] Schema ready');
  return _db;
}

function getDB() {
  if (!_db) throw new Error('Database not initialised yet');
  return _db;
}

module.exports = { initDB, getDB };
