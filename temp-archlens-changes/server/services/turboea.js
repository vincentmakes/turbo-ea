/**
 * Turbo EA Connector v1.0
 * Fetches card data from a Turbo EA instance via its REST API and normalises
 * it into the same fact_sheets format that the LeanIX connector produces.
 */
const fetch = require('node-fetch');
const PAGE_SIZE = 100;
const tokenCache = new Map();

function parseUrl(raw) {
  let s = (raw || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Turbo EA URL is empty');
  if (!s.startsWith('http')) s = 'https://' + s;
  return s;
}

async function getToken(baseUrl, email, password) {
  const url = parseUrl(baseUrl);
  const k = `${url}::${email}`;
  const c = tokenCache.get(k);
  if (c && Date.now() < c.exp - 15_000) return { token: c.t, host: url };

  const res = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const h =
      res.status === 401
        ? ' — Invalid email or password.'
        : res.status === 403
          ? ' — Access denied.'
          : '';
    throw new Error('Auth failed (' + res.status + ')' + h);
  }
  const j = await res.json();
  // Turbo EA tokens last 24h by default
  tokenCache.set(k, { t: j.access_token, exp: Date.now() + 23 * 3600 * 1000 });
  return { token: j.access_token, host: url };
}

async function apiGet(host, token, path) {
  const res = await fetch(`${host}${path}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error(`API ${path} failed (${res.status})`);
  return res.json();
}

// ── Type discovery ──────────────────────────────────────────────────────────
async function discoverTypes(host, token) {
  const data = await apiGet(host, token, '/api/v1/metamodel/types');
  const types = (data || []).filter((t) => !t.is_hidden);
  const results = [];
  for (const t of types) {
    // Get count per type
    const page = await apiGet(
      host,
      token,
      `/api/v1/cards?type=${t.key}&page=1&page_size=1`,
    );
    const count = page.total || 0;
    results.push({ name: t.key, label: t.label, count });
  }
  console.log(
    '[turboea] discovered',
    results.filter((r) => r.count > 0).length,
    'types with data',
  );
  return results;
}

// ── Fetch all cards of a given type (paginated) ─────────────────────────────
async function fetchAllCards(host, token, typeKey, onProgress) {
  let page = 1;
  const all = [];
  let total = null;
  while (true) {
    const data = await apiGet(
      host,
      token,
      `/api/v1/cards?type=${typeKey}&page=${page}&page_size=${PAGE_SIZE}`,
    );
    if (total === null) total = data.total || 0;
    const items = data.items || [];
    if (!items.length) break;
    all.push(...items);
    if (onProgress) onProgress({ fetched: all.length, total });
    if (all.length >= total) break;
    page++;
  }
  return { items: all, total: total || 0 };
}

// ── Fetch stakeholders for cards to find owners ─────────────────────────────
async function fetchStakeholders(host, token, cardId) {
  try {
    const data = await apiGet(
      host,
      token,
      `/api/v1/cards/${cardId}/stakeholders`,
    );
    return data || [];
  } catch {
    return [];
  }
}

// ── Fetch relations to extract vendor info ──────────────────────────────────
async function fetchRelations(host, token, typeKey) {
  try {
    const data = await apiGet(
      host,
      token,
      `/api/v1/relations?source_type=${typeKey}&page_size=1000`,
    );
    return data.items || data || [];
  } catch {
    return [];
  }
}

// ── Normalise a Turbo EA card into the fact_sheets format ───────────────────
function extractLifecycle(card) {
  const lc = card.lifecycle;
  if (!lc) return null;
  // Find the latest phase that has a date
  const phases = ['endOfLife', 'phaseOut', 'active', 'phaseIn', 'plan'];
  for (const p of phases) {
    if (lc[p]) return p;
  }
  return null;
}

function qualityScore(card, owner, lifecycle) {
  // Mirror the same scoring as the LeanIX connector
  let s = 0;
  if (owner) s += 25;
  if (card.description && card.description.trim().length > 10) s += 15;
  if (lifecycle && lifecycle !== 'endOfLife') s += 15;
  // Use Turbo EA's own data_quality as a proxy for completion
  const dq = card.data_quality || 0;
  s += Math.round((dq / 100) * 25);
  // Recency
  const ua = card.updated_at;
  const days = ua
    ? Math.floor((Date.now() - new Date(ua)) / 86400000)
    : 9999;
  if (days < 90) s += 20;
  else if (days < 180) s += 10;
  else if (days < 365) s += 5;
  return Math.min(100, s);
}

function normalise(card, ownerMap, vendorMap) {
  const owner = ownerMap[card.id] || null;
  const lc = extractLifecycle(card);
  const vendors = vendorMap[card.id] || [];
  const score = qualityScore(card, owner?.display_name, lc);
  const ua = card.updated_at;
  const days = ua
    ? Math.floor((Date.now() - new Date(ua)) / 86400000)
    : 9999;

  const issues = [];
  if (!owner) issues.push('no-owner');
  if (!card.description || card.description.trim().length < 5)
    issues.push('no-description');
  if (!lc) issues.push('no-lifecycle');
  else if (lc === 'endOfLife') issues.push('eol');
  else if (lc === 'phaseOut') issues.push('retiring');
  if (days > 180) issues.push('stale-' + days + 'd');
  if ((card.data_quality || 0) < 50) issues.push('incomplete');

  const attrs = card.attributes || {};

  return {
    id: card.id,
    fs_type: card.type,
    name: card.name || '(unnamed)',
    description: card.description || '',
    lifecycle: lc || 'Not set',
    owner: owner?.display_name || null,
    owner_email: owner?.email || null,
    completion: (card.data_quality || 0) / 100,
    updated_at: ua || null,
    quality_score: score,
    locker: score < 45 ? 'bronze' : score < 80 ? 'silver' : 'gold',
    issues: JSON.stringify(issues),
    tags: JSON.stringify(
      (card.tags || []).map((t) => t.name || t.tag_name || t),
    ),
    vendors: JSON.stringify(vendors),
    criticality: attrs.businessCriticality || null,
    tech_fit: attrs.technicalFit || null,
    fs_level: null,
    annual_cost: attrs.costTotalAnnual || 0,
  };
}

// ── Main sync function ──────────────────────────────────────────────────────
async function syncWorkspace(baseUrl, email, password, options = {}, emit = () => {}) {
  const e = (event, data) => emit({ event, ...data });

  e('step', { step: 'auth', status: 'active', msg: 'Authenticating with Turbo EA...' });
  const { token, host } = await getToken(baseUrl, email, password);
  e('step', { step: 'auth', status: 'done', msg: 'Authenticated → ' + host });

  e('step', {
    step: 'discover',
    status: 'active',
    msg: 'Discovering card types...',
  });
  let allTypes = await discoverTypes(host, token);

  if (options.fsTypes && options.fsTypes !== 'all') {
    const req = options.fsTypes
      .split(',')
      .map((s) => s.trim().toLowerCase());
    allTypes = allTypes.filter((t) =>
      req.some((r) => t.name.toLowerCase().includes(r)),
    );
  }

  const withData = allTypes.filter((t) => t.count > 0);
  const grandTotal = withData.reduce((s, t) => s + t.count, 0);
  e('step', {
    step: 'discover',
    status: 'done',
    msg:
      withData.length +
      ' types · ' +
      grandTotal.toLocaleString() +
      ' records',
    types: allTypes,
  });

  const results = {};
  for (const ft of withData) {
    e('type_start', { fsType: ft.name, total: ft.count });
    try {
      const { items: cards } = await fetchAllCards(
        host,
        token,
        ft.name,
        (prog) =>
          e('type_progress', {
            fsType: ft.name,
            fetched: prog.fetched,
            total: prog.total,
          }),
      );

      // Build owner map from stakeholders (batch for efficiency)
      const ownerMap = {};
      // Only fetch stakeholders for first 200 cards to avoid excessive API calls
      const toFetch = cards.slice(0, 200);
      for (const card of toFetch) {
        if (card.stakeholders && card.stakeholders.length) {
          const responsible = card.stakeholders.find(
            (s) =>
              s.role_key === 'responsible' || s.role_key === 'accountable',
          );
          if (responsible) {
            ownerMap[card.id] = {
              display_name: responsible.user_display_name || responsible.display_name,
              email: responsible.user_email || responsible.email,
            };
          }
        }
      }

      // Build vendor map from Provider relations
      const vendorMap = {};
      // Cards may have tags with vendor info or relations
      for (const card of cards) {
        vendorMap[card.id] = [];
      }

      // Try fetching Provider relations for relevant types
      if (['Application', 'ITComponent'].includes(ft.name)) {
        try {
          const rels = await fetchRelations(host, token, ft.name);
          for (const rel of rels) {
            if (rel.target_type === 'Provider' || rel.source_type === 'Provider') {
              const cardId =
                rel.source_type === 'Provider' ? rel.target_id : rel.source_id;
              const vendorName =
                rel.source_type === 'Provider'
                  ? rel.source_name
                  : rel.target_name;
              if (vendorMap[cardId] && vendorName) {
                vendorMap[cardId].push(vendorName);
              }
            }
          }
        } catch {
          // Relations endpoint may not support source_type filter
        }
      }

      const items = cards.map((c) => normalise(c, ownerMap, vendorMap));
      results[ft.name] = items;
      e('type_done', {
        fsType: ft.name,
        count: items.length,
        bronze: items.filter((i) => i.locker === 'bronze').length,
        silver: items.filter((i) => i.locker === 'silver').length,
        gold: items.filter((i) => i.locker === 'gold').length,
      });
    } catch (err) {
      e('type_error', { fsType: ft.name, error: err.message });
      results[ft.name] = [];
    }
  }

  const allItems = Object.values(results).flat();
  e('complete', {
    total: allItems.length,
    bronze: allItems.filter((i) => i.locker === 'bronze').length,
    silver: allItems.filter((i) => i.locker === 'silver').length,
    gold: allItems.filter((i) => i.locker === 'gold').length,
    types: allTypes,
  });
  return { results, allTypes, host };
}

module.exports = { syncWorkspace, getToken, discoverTypes, parseUrl };
