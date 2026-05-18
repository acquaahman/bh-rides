// ============================================================
//  Netlify Function: notify-sms.js
//  Location in your project: netlify/functions/notify-sms.js
//
//  This function receives ride request data from the B&H Rides
//  website and sends an SMS notification via Twilio.
//
//  Environment variables to set in Netlify dashboard:
//    TWILIO_ACCOUNT_SID   → your Twilio Account SID
//    TWILIO_AUTH_TOKEN    → your Twilio Auth Token
//    TWILIO_FROM_NUMBER   → +13254425692
//    NOTIFY_NUMBER        → +19728248330
// ============================================================

exports.handler = async function (event, context) {

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse the incoming request body
  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Pull credentials from environment variables (never hardcoded)
  const accountSid  = process.env.TWILIO_ACCOUNT_SID;
  const authToken   = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber  = process.env.TWILIO_FROM_NUMBER;
  const toNumber    = process.env.NOTIFY_NUMBER;

  // Build the SMS message
  const message = data.message || [
    `🚗 New B&H Ride Request`,
    `Name: ${data.name} — Unit ${data.unit}`,
    `Phone: ${data.phone}`,
    `Airport: ${data.destination}`,
    `Date: ${data.date} at ${data.time}`,
    `Driver: ${data.driver}`,
    `Payment: ${data.paymentMethod}`,
    `Notes: ${data.notes || 'None'}`
  ].join('\n');

  // Twilio REST API endpoint
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  // Encode credentials for Basic Auth
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  // Build the form-encoded body Twilio expects
  const body = new URLSearchParams({
    From: fromNumber,
    To:   toNumber,
    Body: message
  }).toString();

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded'
      },
      body
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Twilio error:', result);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: result.message || 'Twilio error' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, sid: result.sid })
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
