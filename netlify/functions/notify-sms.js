// ============================================================
//  Netlify Function: notify-sms.js
//  Location: netlify/functions/notify-sms.js
//
//  Handles two cases:
//  1. New ride request (public booking form) → texts Brian & Hilary ONLY
//  2. Accept/Decline (dashboard) → texts the rider
//
//  Security:
//  - Public callers (no access code) can only send ride-request alerts,
//    and only to Brian & Hilary. Any "to" field is refused.
//  - Dashboard callers send the access code in the x-dash-code header.
//    Only then is a "to" number honoured.
//
//  Environment variables in Netlify dashboard:
//    TWILIO_ACCOUNT_SID   → your Twilio Account SID
//    TWILIO_AUTH_TOKEN    → your Twilio Auth Token
//    TWILIO_FROM_NUMBER   → +13254425692
//    NOTIFY_NUMBER_BRIAN  → +19728248330
//    NOTIFY_NUMBER_HILARY → +19728221457
//    DASHBOARD_CODE       → the dashboard access code (NEW)
// ============================================================

const crypto = require('crypto');

// The only message openers the public booking form is allowed to send
const PUBLIC_PREFIXES = ['🚗 New B&H Ride Request', 'New Round Trip Request'];
const MAX_MESSAGE_LENGTH = 1000;

const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reply = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

function codeOk(provided) {
  const expected = process.env.DASHBOARD_CODE;
  if (!expected || !provided) return false;
  return crypto.timingSafeEqual(sha(provided), sha(expected));
}

// Twilio needs E.164 (+1XXXXXXXXXX). Riders' numbers are stored like (214) 449-8157.
function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}

const mask = n => String(n || '').replace(/\d(?=\d{4})/g, '•');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }

  const message = data && data.message;
  if (!message || typeof message !== 'string') return reply(400, { error: 'No message provided' });
  if (message.length > MAX_MESSAGE_LENGTH) return reply(413, { error: 'Message too long' });

  const authed = codeOk(event.headers && event.headers['x-dash-code']);

  let recipients;
  if (data.to) {
    // Texting a specific number (a rider) requires the dashboard access code
    if (!authed) {
      await sleep(600);
      return reply(401, { error: 'Not authorized' });
    }
    const e164 = toE164(data.to);
    if (!e164) return reply(400, { error: 'Invalid phone number' });
    recipients = [e164];
  } else {
    // No "to": this is a ride-request alert for Brian & Hilary.
    // Public callers may only send the booking form's alert formats.
    if (!authed && !PUBLIC_PREFIXES.some(p => message.startsWith(p))) {
      return reply(403, { error: 'Message not allowed' });
    }
    recipients = [process.env.NOTIFY_NUMBER_BRIAN, process.env.NOTIFY_NUMBER_HILARY];
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  const url         = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const results     = [];

  for (const to of recipients) {
    if (!to) continue;
    const body = new URLSearchParams({ From: fromNumber, To: to, Body: message }).toString();
    try {
      const res    = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const result = await res.json();
      console.log('Twilio response for', mask(to), ':', res.status, result.sid || result.message);
      results.push({ to: mask(to), ok: res.ok, sid: result.sid, error: result.message });
    } catch (err) {
      console.log('Fetch error for', mask(to), ':', err.message);
      results.push({ to: mask(to), ok: false, error: err.message });
    }
  }

  const allOk = results.length > 0 && results.every(r => r.ok);
  return reply(allOk ? 200 : 207, { results });
};
