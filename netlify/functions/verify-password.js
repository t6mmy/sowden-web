const FIREBASE_URL = process.env.FIREBASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_FROM = 'onboarding@resend.dev';

function buildPassword(version) {
  return `sowden-${String(version).padStart(3, '0')}`;
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload && payload.error ? payload.error : 'Request failed';
    throw new Error(message);
  }

  return payload;
}

async function readPasswordState() {
  if (!FIREBASE_URL) {
    throw new Error('Missing FIREBASE_URL environment variable');
  }

  return fetchJSON(`${FIREBASE_URL}/passwordState.json`);
}

async function writePasswordState(state) {
  if (!FIREBASE_URL) {
    throw new Error('Missing FIREBASE_URL environment variable');
  }

  return fetchJSON(`${FIREBASE_URL}/passwordState.json`, {
    method: 'PUT',
    body: JSON.stringify(state),
  });
}

async function sendPasswordEmail(newPassword, version) {
  if (!RESEND_API_KEY || ADMIN_EMAILS.length === 0) {
    return;
  }

  const recipients = ADMIN_EMAILS;
  const subject = `New Sowden password (${version})`;
  const message = `Your password for the family site has been updated.\n\nPassword: ${newPassword}\n\nThis password will stay active for 7 days.\n\nIf you did not expect this email, please ignore it.`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: recipients,
      subject,
      text: message,
    }),
  });
}

function getDefaultState() {
  return {
    currentPassword: 'sowden-001',
    version: 1,
    lastUpdated: Date.now(),
    previousPasswords: [],
  };
}

exports.handler = async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, message: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const submittedPassword = String(body.password || '').trim();

    if (!submittedPassword) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: 'Password is required' }),
      };
    }

    let state = await readPasswordState().catch(() => null);

    if (!state || typeof state !== 'object') {
      state = getDefaultState();
      await writePasswordState(state);
    }

    const now = Date.now();
    const lastUpdated = Number(state.lastUpdated || now);

    if (now - lastUpdated >= SEVEN_DAYS_MS) {
      const nextVersion = Number(state.version || 0) + 1;
      const nextPassword = buildPassword(nextVersion);

      state = {
        currentPassword: nextPassword,
        version: nextVersion,
        lastUpdated: now,
        previousPasswords: [
          ...(Array.isArray(state.previousPasswords) ? state.previousPasswords : []),
          String(state.currentPassword || '').trim(),
        ].slice(-10),
      };

      await writePasswordState(state);
      await sendPasswordEmail(nextPassword, nextVersion).catch(() => {});
    }

    const success = submittedPassword === state.currentPassword;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success,
        message: success ? 'Access granted' : 'Incorrect password',
        expiresAt: Number(state.lastUpdated) + SEVEN_DAYS_MS,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: error.message || 'Something went wrong',
      }),
    };
  }
};
