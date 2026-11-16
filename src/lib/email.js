const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const client = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
const welcomeEmail = {
  async send(address, preferences) {
    if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured');
    await client.send(new SendEmailCommand({
      Source: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [address] },
      Message: {
        Subject: { Data: 'Welcome to Lexicon 2026' },
        Body: { Text: { Data: `Welcome to Lexicon 2026!\n\nThanks for joining our collaborative dictionary game. We look forward to seeing what you create.\n\nYour email preferences:\n- When a player creates a word: ${preferences.notify_word_created ? 'On' : 'Off'}\n- When all players complete their word: ${preferences.notify_round_complete ? 'On' : 'Off'}\n\nThe Lexicon team` } }
      }
    }));
  }
};

function normalizeEmail(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (!email) return '';
  if (email.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(email)) return null;
  return email;
}

function getEmailPreferences(body, existing = {}) {
  const keys = ['notify_word_created', 'notify_round_complete'];
  const preferences = {};
  for (const key of keys) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') return null;
    preferences[key] = body[key] === undefined ? existing[key] === true : body[key];
  }
  return preferences;
}

async function sendWelcome(email, preferences) {
  if (!email) return undefined;
  try {
    await welcomeEmail.send(email, preferences);
    return undefined;
  } catch (err) {
    console.error('[EMAIL] Welcome email could not be sent:', err.name);
    return 'Your profile was saved, but the welcome email could not be sent.';
  }
}

module.exports = { normalizeEmail, getEmailPreferences, sendWelcome, welcomeEmail };
