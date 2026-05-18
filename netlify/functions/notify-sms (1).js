// ============================================================
//  Netlify Function: notify-sms.js
//  Location: netlify/functions/notify-sms.js
//
//  Handles two cases:
//  1. New ride request → texts Brian & Hilary
//  2. Accept/Decline → texts the rider
//
//  Environment variables in Netlify dashboard:
//    TWILIO_ACCOUNT_SID   → your Twilio Account SID
//    TWILIO_AUTH_TOKEN    → your Twilio Auth Token
//    TWILIO_FROM_NUMBER   → +13254425692
//    NOTIFY_NUMBER_BRIAN  → +19728248330
//    NOTIFY_NUMBER_HILARY → +19728221457
// ============================================================

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  const recipients = data.to
    ? [data.to]
    : [process.env.NOTIFY_NUMBER_BRIAN, process.env.NOTIFY_NUMBER_HILARY];

  const message = data.message;
  if (!message) return { statusCode: 400, body: 'No message provided' };

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
      results.push({ to, ok: res.ok, sid: result.sid, error: result.message });
    } catch (err) {
      results.push({ to, ok: false, error: err.message });
    }
  }

  const allOk = results.every(r => r.ok);
  return { statusCode: allOk ? 200 : 207, body: JSON.stringify({ results }) };
};
