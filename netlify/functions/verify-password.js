const FIREBASE_URL = process.env.FIREBASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_FROM = 'onboarding@resend.dev';

const WORD_LIST = [
  'aurora', 'breeze', 'crystal', 'dream', 'echo', 'forest', 'garden', 'harmony',
  'island', 'journey', 'kingdom', 'light', 'mountain', 'night', 'ocean', 'peace',
  'quest', 'river', 'silver', 'thunder', 'unity', 'valley', 'wonder', 'zenith',
  'amber', 'blaze', 'cosmic', 'dazzle', 'eternal', 'flame', 'gentle', 'hidden',
  'icy', 'jade', 'keen', 'lunar', 'magic', 'nebula', 'orbit', 'pearl',
  'quiet', 'radiant', 'serene', 'twilight', 'unique', 'vivid', 'whisper', 'zenlike'
];

function generateRandomPassword() {
  const word1 = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  const word2 = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  const word3 = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  return `${word1}-${word2}-${word3}`;
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
  console.log('--- Email Check Started ---');
  console.log('API Key exists?', !!RESEND_API_KEY);
  console.log('Admin Emails:', ADMIN_EMAILS);

  if (!RESEND_API_KEY || ADMIN_EMAILS.length === 0) {
    console.log('Email aborted: Missing API key or admin emails');
    return;
  }

  const subject = `New Sowden password`;
  const message = `Your password for the family site has been updated.\n\nPassword: ${newPassword}\n\nThis password will stay active for 7 days.\n\nIf you did not expect this email, please ignore it.`;

  console.log('Attempting to send via Resend...');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: ADMIN_EMAILS,
      subject,
      text: message,
    }),
  });

  const responseText = await response.text();
  console.log('Resend Response Status:', response.status);
  console.log('Resend Response Body:', responseText);
}

function getDefaultState() {
  const initialPassword = generateRandomPassword();
  return {
    currentPassword: initialPassword,
    lastUpdated: Date.now(),
    emailSent: false,
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
      // Send initial email
      await sendPasswordEmail(state.currentPassword).catch(() => {});
    }

    const now = Date.now();
    const lastUpdated = Number(state.lastUpdated || now);

    // Check if 7 days have passed
    if (now - lastUpdated >= SEVEN_DAYS_MS) {
      const nextPassword = generateRandomPassword();

      state = {
        currentPassword: nextPassword,
        lastUpdated: now,
        emailSent: false,
        previousPasswords: [
          ...(Array.isArray(state.previousPasswords) ? state.previousPasswords : []),
          String(state.currentPassword || '').trim(),
        ].slice(-10),
      };

      await writePasswordState(state);
      await sendPasswordEmail(nextPassword).catch(() => {});
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
