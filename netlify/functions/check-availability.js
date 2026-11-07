// ============================================================
//  Netlify Function: check-availability.js   (NEW)
//  Location: netlify/functions/check-availability.js
//
//  Used by the public booking form for the 45-minute double-booking
//  check. It answers yes/no only — no names, phones or addresses
//  ever leave the server.
//
//  Environment variables in Netlify dashboard:
//    SUPABASE_SERVICE_KEY   → Supabase secret / service_role key
//    SUPABASE_URL           → (optional) defaults to the B&H project URL
// ============================================================

const DEFAULT_SUPABASE_URL = 'https://ohiutjikhkxiwmgqvncb.supabase.co';
const BUFFER_MINUTES = 45;

const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

  let data;
  try { data = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

  const { date, time } = data || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}/.test(String(time || ''))) {
    return reply(400, { error: 'Invalid date or time' });
  }

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return reply(500, { error: 'Server not configured' });

  const headers = { 'apikey': key };
  if (key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${key}`;

  const base = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  try {
    const res = await fetch(
      `${base}/rest/v1/ride_requests?ride_date=eq.${date}&status=in.(pending,confirmed)&select=ride_time`,
      { headers }
    );
    const rows = await res.json();
    if (!res.ok || !Array.isArray(rows)) return reply(502, { error: 'Upstream error' });

    const [h, m] = String(time).split(':').map(Number);
    const mins = h * 60 + m;
    const conflict = rows.some(r => {
      const [bh, bm] = String(r.ride_time).split(':').map(Number);
      return Math.abs(mins - (bh * 60 + bm)) < BUFFER_MINUTES;
    });
    return reply(200, { conflict });
  } catch (err) {
    console.log('check-availability error:', err.message);
    return reply(502, { error: 'Upstream error' });
  }
};
