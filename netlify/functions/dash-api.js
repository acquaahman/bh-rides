// ============================================================
//  Netlify Function: dash-api.js   (NEW)
//  Location: netlify/functions/dash-api.js
//
//  The dashboard's only door to the ride_requests table.
//  The browser never talks to Supabase directly any more.
//
//  Every request must carry the dashboard access code in the
//  x-dash-code header. The code is checked here, on the server.
//
//  Environment variables in Netlify dashboard:
//    DASHBOARD_CODE         → the dashboard access code
//    SUPABASE_SERVICE_KEY   → Supabase secret / service_role key
//    SUPABASE_URL           → (optional) defaults to the B&H project URL
// ============================================================

const crypto = require('crypto');

const DEFAULT_SUPABASE_URL = 'https://ohiutjikhkxiwmgqvncb.supabase.co';

// Only this table, only these verbs, only these fields
const PATH_RE        = /^ride_requests(\?[A-Za-z0-9_=.,&():%*-]*)?$/;
const ALLOWED_VERBS  = ['GET', 'PATCH', 'DELETE'];
const PATCH_STATUSES = ['pending', 'confirmed', 'declined', 'completed'];
const ID_FILTER_RE   = /[?&]id=eq\.[A-Za-z0-9-]+(&|$)/;

// ---- Which ride fields the dashboard may change, and what each may contain ----
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE  = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const text = (max, required) => v => (v === null || v === undefined || v === '')
  ? !required
  : (typeof v === 'string' && v.length <= max && v.trim().length > 0);
const FIELD_RULES = {
  // status handling
  status:        v => PATCH_STATUSES.includes(v),
  responded_at:  v => v === null || !Number.isNaN(Date.parse(v)),
  completed_at:  v => v === null || !Number.isNaN(Date.parse(v)),
  // "needs info" flag
  needs_info:      v => typeof v === 'boolean',
  needs_info_note: text(500),
  // rider
  name:    text(100, true),
  phone:   v => typeof v === 'string' && /^[0-9()+\-.\s]{7,25}$/.test(v) && v.replace(/\D/g, '').length >= 10,
  email:   v => v === null || v === '' || (typeof v === 'string' && v.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
  address: text(200, true),
  // outbound trip
  pickup:         text(120, true),
  other_pickup:   text(200),
  destination:    text(120, true),
  ride_date:      v => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)),
  ride_time:      v => typeof v === 'string' && TIME_RE.test(v),
  passengers:     v => /^[1-9]\d?$/.test(String(v)),
  luggage:        v => v === null || v === '' || /^\d{1,2}$/.test(String(v)),
  airline:        text(60),
  flight_number:  text(20),
  departure_time: v => v === null || v === '' || TIME_RE.test(v),
  est_miles:      text(40),
  payment_method: v => ['Venmo', 'Zelle', 'Cash'].includes(v),
  notes:          text(1000),
  // return trip (round trips)
  pickup2:            text(120),
  destination2:       text(120),
  other_destination2: text(200),
  ride_date2:         v => v === null || v === '' || (typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v))),
  ride_time2:         v => v === null || v === '' || TIME_RE.test(v),
  airline2:           text(60),
  flight_number2:     text(20),
  arrival_time2:      v => v === null || v === '' || TIME_RE.test(v),
  est_miles2:         text(40)
};
const PATCH_FIELDS = Object.keys(FIELD_RULES);
// Changing any of these counts as an "edit" (stamps last_edited_at on the server)
const NON_EDIT_FIELDS = ['status', 'responded_at', 'completed_at', 'needs_info', 'needs_info_note'];

const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj)
});

function codeOk(provided) {
  const expected = process.env.DASHBOARD_CODE;
  if (!expected || !provided) return false;
  return crypto.timingSafeEqual(sha(provided), sha(expected));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!process.env.DASHBOARD_CODE || !key) {
    return reply(500, { error: 'Server not configured' });
  }

  if (!codeOk(event.headers && event.headers['x-dash-code'])) {
    await sleep(600); // slow down code guessing
    return reply(401, { error: 'Not authorized' });
  }

  let data;
  try { data = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

  // Login check: the code was already verified above
  if (data.action === 'login') return reply(200, { ok: true });

  const path   = String(data.path || '');
  const method = String(data.method || 'GET').toUpperCase();

  if (!PATH_RE.test(path))             return reply(400, { error: 'Path not allowed' });
  if (!ALLOWED_VERBS.includes(method)) return reply(400, { error: 'Method not allowed' });

  // Edits and deletes must target a single booking
  if ((method === 'PATCH' || method === 'DELETE') && !ID_FILTER_RE.test(path)) {
    return reply(400, { error: 'An id filter is required' });
  }

  let body;
  if (method === 'PATCH') {
    let fields;
    try { fields = JSON.parse(data.body); } catch { return reply(400, { error: 'Invalid body' }); }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return reply(400, { error: 'Invalid body' });
    const keys = Object.keys(fields);
    if (!keys.length || !keys.every(k => PATCH_FIELDS.includes(k))) return reply(400, { error: 'Field not allowed' });
    const bad = keys.find(k => !FIELD_RULES[k](fields[k]));
    if (bad) return reply(400, { error: 'Invalid value for ' + bad });
    // Normalize empty strings to null so optional columns stay clean
    for (const k of keys) { if (fields[k] === '') fields[k] = null; }
    // The server (not the browser) stamps when a ride's details were edited
    if (keys.some(k => !NON_EDIT_FIELDS.includes(k))) fields.last_edited_at = new Date().toISOString();
    body = JSON.stringify(fields);
  }

  const headers = { 'apikey': key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${key}`; // legacy JWT-style service_role key
  if (method === 'PATCH') headers['Prefer'] = 'return=representation';

  const base = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  try {
    const res  = await fetch(`${base}/rest/v1/${path}`, { method, headers, body });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: res.status === 204 ? '' : text
    };
  } catch (err) {
    console.log('dash-api fetch error:', err.message);
    return reply(502, { error: 'Upstream error' });
  }
};
