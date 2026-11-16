const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const client = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

function preferenceMessage(preferences) {
  if (preferences.notify_word_created && preferences.notify_round_complete) {
    return 'We will email you whenever a player submits a new word, and also when the round is over and everyone has submitted a word.';
  }
  if (preferences.notify_word_created) {
    return 'We will email you every time a player submits a new word.';
  }
  if (preferences.notify_round_complete) {
    return 'We will email you only once the round is over, and every player has finished submitting a new word.';
  }
  return 'We have your email address now, but this will be the only email you get. If you want to update your preferences (e.g., to get an email every time the round ends) you can do so by editting your profile.';
}

const welcomeEmail = {
  async send(address, preferences) {
    if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured');
    await client.send(new SendEmailCommand({
      Source: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [address] },
      Message: {
        Subject: { Data: 'Welcome to Lexicon 2026' },
        Body: { Text: { Data: `Welcome to Lexicon 2026!\n\nThanks for joining our collaborative dictionary game. We look forward to seeing what you create.\n\n${preferenceMessage(preferences)}\n\nThe Lexicon team` } }
      }
    }));
  }
};

const roundEmail = {
  async send(address, gameName, letter, nextLetter) {
    if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured');
    const announcement = nextLetter
      ? `Round ${letter} is over, and the new round will start with letter ${nextLetter}.\n\nPlease remember to define previously undefined words first before making a new word for this letter.`
      : `Round ${letter} is over, and ${gameName} is complete.`;
    await client.send(new SendEmailCommand({
      Source: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [address] },
      Message: {
        Subject: { Data: `${gameName}: Round ${letter} is over` },
        Body: { Text: { Data: `${announcement}\n\nThe Lexicon team` } }
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

module.exports = { normalizeEmail, getEmailPreferences, sendWelcome, welcomeEmail, roundEmail };
