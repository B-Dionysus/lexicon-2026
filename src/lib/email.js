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

const EMAIL_BODY_WIDTH = 40;
const EMAIL_CONTENT_WIDTH = EMAIL_BODY_WIDTH - 4;
const EMAIL_BORDER_STYLES = [
  { topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+', horizontal: '-', left: '|', right: '|' },
  { topLeft: '/', topRight: '\\', bottomLeft: '\\', bottomRight: '/', horizontal: '-', left: '|', right: '|' },
  { topLeft: '*', topRight: '*', bottomLeft: '*', bottomRight: '*', horizontal: '*', left: '*', right: '*' },
  { topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+', horizontal: '=', left: '!', right: '!' },
  { topLeft: '[', topRight: ']', bottomLeft: '[', bottomRight: ']', horizontal: '=', left: '|', right: '|' },
  { topLeft: '<', topRight: '>', bottomLeft: '<', bottomRight: '>', horizontal: '-', left: ':', right: ':' },
  { topLeft: ':', topRight: ':', bottomLeft: ':', bottomRight: ':', horizontal: '.', left: ':', right: ':' },
  { topLeft: '#', topRight: '#', bottomLeft: '#', bottomRight: '#', horizontal: '#', left: '#', right: '#' },
  { topLeft: '~', topRight: '~', bottomLeft: '~', bottomRight: '~', horizontal: '~', left: '~', right: '~' },
  { topLeft: '"', topRight: '"', bottomLeft: '"', bottomRight: '"', horizontal: '_', left: '|', right: '|' }
];

function formatEmailBody(content) {
  const style = EMAIL_BORDER_STYLES[Math.floor(Math.random() * EMAIL_BORDER_STYLES.length)];
  const topBorder = `${style.topLeft}${style.horizontal.repeat(EMAIL_BODY_WIDTH - 2)}${style.topRight}`;
  const bottomBorder = `${style.bottomLeft}${style.horizontal.repeat(EMAIL_BODY_WIDTH - 2)}${style.bottomRight}`;
  const lines = [];
  for (const sourceLine of content.split('\n')) {
    if (!sourceLine) {
      lines.push([]);
      continue;
    }

    let parts = [];
    let length = 0;
    const addPart = (text, href) => {
      const previous = parts.at(-1);
      if (previous && previous.href === href) previous.text += text;
      else parts.push({ text, href });
      length += Array.from(text).length;
    };
    const newLine = () => {
      lines.push(parts);
      parts = [];
      length = 0;
    };

    for (const word of sourceLine.trim().split(/\s+/)) {
      const href = /^https?:\/\/\S+$/.test(word) ? word : undefined;
      const characters = Array.from(word);
      if (characters.length > EMAIL_CONTENT_WIDTH) {
        if (length) newLine();
        for (let offset = 0; offset < characters.length; offset += EMAIL_CONTENT_WIDTH) {
          if (length) newLine();
          addPart(characters.slice(offset, offset + EMAIL_CONTENT_WIDTH).join(''), href);
        }
        continue;
      }

      const space = length ? 1 : 0;
      if (length + space + characters.length > EMAIL_CONTENT_WIDTH) newLine();
      if (length) addPart(' ', undefined);
      addPart(word, href);
    }
    lines.push(parts);
  }

  const renderLine = (parts, html) => {
    const content = parts.map(({ text, href }) => {
      if (!html) return text;
      const escaped = escapeHtml(text);
      return href ? `<a href="${escapeHtml(href)}">${escaped}</a>` : escaped;
    }).join('');
    const length = parts.reduce((total, part) => total + Array.from(part.text).length, 0);
    const [left, right] = html ? [escapeHtml(style.left), escapeHtml(style.right)] : [style.left, style.right];
    return `${left} ${content}${' '.repeat(EMAIL_CONTENT_WIDTH - length)} ${right}`;
  };
  const text = [topBorder, ...lines.map((line) => renderLine(line, false)), bottomBorder].join('\n');
  const html = `<pre style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere">${[
    escapeHtml(topBorder), ...lines.map((line) => renderLine(line, true)), escapeHtml(bottomBorder)
  ].join('\n')}</pre>`;
  return { text, html };
}

const welcomeEmail = {
  async send(address, preferences) {
    if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured');
    const body = formatEmailBody(`Welcome to Lexicon 2026!\n\nThanks for joining our collaborative dictionary game. We look forward to seeing what you create.\n\n${preferenceMessage(preferences)}\n\nThe Lexicon team`);
    await client.send(new SendEmailCommand({
      Source: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [address] },
      Message: {
        Subject: { Data: 'Welcome to Lexicon 2026' },
        Body: {
          Text: { Data: body.text, Charset: 'UTF-8' },
          Html: { Data: body.html, Charset: 'UTF-8' }
        }
      }
    }));
  }
};

const roundEmail = {
  async send(address, gameName, letter, nextLetter, gameId) {
    if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured');
    let subject = `${gameName}: Round ${letter} is over`;
    let text = `Round ${letter} is over, and ${gameName} is complete.\n\nThe Lexicon team`;
    if (nextLetter) {
      if (!process.env.SITE_URL) throw new Error('SITE_URL is not configured');
      const gameUrl = new URL('/index.html', process.env.SITE_URL);
      gameUrl.searchParams.set('game_id', gameId);
      subject = `[Lexicon] ${gameName}: Time for a new letter`;
      text = `Good news! We are moving on to the ${nextLetter} words!\n\nClick here to add a new ${nextLetter} word:\n${gameUrl}\n\nPlease remember to defined previously-existing but undefined ${nextLetter} words before creating a brand new entry.`;
    }
    const body = formatEmailBody(text);
    await client.send(new SendEmailCommand({
      Source: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [address] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: body.text, Charset: 'UTF-8' }, Html: { Data: body.html, Charset: 'UTF-8' } }
      }
    }));
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

const wordEmail = {
  async send(address, gameName, researcherName, word) {
    if (!process.env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured');
    if (!process.env.SITE_URL) throw new Error('SITE_URL is not configured');
    const wordUrl = new URL('/defined-word.html', process.env.SITE_URL);
    wordUrl.searchParams.set('word_id', word.word_id);
    wordUrl.searchParams.set('game_id', word.game_id);
    const profileUrl = new URL('/profile.html', process.env.SITE_URL);
    profileUrl.searchParams.set('user_name', word.user_name);
    profileUrl.searchParams.set('game_id', word.game_id);
    const body = formatEmailBody(`Good news! Another word has been added to the Lexicon for ${gameName}:\nWord: ${word.word}\n${wordUrl}\n\nCreated by ${researcherName}\n${profileUrl}`);
    await client.send(new SendEmailCommand({
      Source: process.env.EMAIL_FROM,
      Destination: { ToAddresses: [address] },
      Message: {
        Subject: { Data: `[Lexicon] ${gameName} ${researcherName} has added a new word to the lexicon!`, Charset: 'UTF-8' },
        Body: { Text: { Data: body.text, Charset: 'UTF-8' }, Html: { Data: body.html, Charset: 'UTF-8' } }
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

module.exports = { normalizeEmail, getEmailPreferences, sendWelcome, welcomeEmail, roundEmail, wordEmail };
