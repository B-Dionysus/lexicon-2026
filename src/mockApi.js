const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { normalizeGameId, decorateWordsWithResearcherNames } = require('./lib/utils');
const { normalizeEmail, getEmailPreferences } = require('./lib/email');

const app = express();
app.use(express.json());

// Simple server-side debug logger for the mock API
function debugLog(...args) {
  try {
    console.log('[MOCKAPI]', ...args);
  } catch (e) {}
}

debugLog('mockApi starting');

const words = [];
const profiles = [];
const games = [
  { game_id: 'default', name: 'Example Game' },
  { game_id: 'local', name: 'Local Game' }
];
app.locals.profiles = profiles;
app.locals.games = games;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const researchers = [];
const isMember = (profile, gameId) => profile.game_id === gameId || researchers.some((row) => row.user_name === profile.user_name && row.game_id === gameId);
const withResearcher = (profile, gameId) => {
  const row = researchers.find((entry) => entry.user_name === profile.user_name && entry.game_id === gameId);
  return { researcher_name: (row && row.researcher_name) || profile.researcher_name, researcher_bio: (row && row.researcher_bio) || profile.researcher_bio };
};
const saveResearcher = (userName, gameId, fields) => {
  const row = researchers.find((entry) => entry.user_name === userName && entry.game_id === gameId);
  if (row) Object.assign(row, fields); else researchers.push({ user_name: userName, game_id: gameId, ...fields });
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function authMiddleware(req, res, next) {
  // Middleware to validate JWT token and attach user to the request
  const header = req.get('Authorization') || '';
  debugLog('authMiddleware: header present', !!header);
  if (!header.startsWith('Bearer ')) {
    debugLog('authMiddleware: missing Bearer token');
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    debugLog('authMiddleware: verified user', req.user && req.user.user_name);
    next();
  } catch (err) {
    debugLog('authMiddleware: verify failed', err && err.message);
    return res.status(401).json({ error: 'Authentication required' });
  }
}

app.get('/api/game', (req, res) => {
  const gameId = normalizeGameId(req.query.game_id);
  const game = games.find((entry) => entry.game_id === gameId);
  res.json({ game: { game_id: gameId, subtitle: game?.subtitle || '' } });
});

app.get('/api/words', (req, res) => {
  // Return list of words for a game
  const gameId = normalizeGameId(req.query.game_id);
  debugLog('/api/words: gameId', gameId);
  const filtered = words.filter((word) => word.game_id === gameId);
  filtered.sort((a, b) => a.word.localeCompare(b.word) || (a.created_at || '').localeCompare(b.created_at || ''));
  const profilesByUserName = Object.fromEntries(profiles.map((profile) => [profile.user_name, profile]));
  debugLog('/api/words: count', filtered.length);
  res.json({ words: decorateWordsWithResearcherNames(filtered, profilesByUserName, Object.fromEntries(researchers.filter((row) => row.game_id === gameId).map((row) => [row.user_name, row]))) });
});

app.get('/api/words/:word_id', (req, res) => {
  debugLog('/api/words/:word_id', req.params.word_id);
  const word = words.find((entry) => entry.word_id === req.params.word_id);
  if (!word) {
    debugLog('/api/words/:word_id not found', req.params.word_id);
    return res.status(404).json({ error: 'Word not found' });
  }
  res.json({ word });
});

app.post('/api/words', authMiddleware, (req, res) => {
  debugLog('POST /api/words by', req.user && req.user.user_name);
  const gameId = normalizeGameId(req.body.game_id);
  const wordText = (req.body.word || '').trim().toLowerCase();
  debugLog('POST /api/words body keys', Object.keys(req.body || {}));
  if (!wordText) {
    debugLog('POST /api/words missing word');
    return res.status(400).json({ error: 'Word is required' });
  }
  const notify = (item) => profiles.some((profile) =>
    isMember(profile, item.game_id) && profile.email && profile.notify_word_created === true);
  if (req.body.word_id) {
    const existing = words.find((word) => word.word_id === req.body.word_id);
    if (!existing) return res.status(404).json({ error: 'Word not found' });
    if (existing.user_name !== req.user.user_name) return res.status(403).json({ error: 'Forbidden' });
    const definition = req.body.definition || '';
    const firstDefinition = !existing.definition?.trim() && Boolean(definition.trim());
    existing.definition = definition;
    existing.updated_at = new Date().toISOString();
    return res.json({ word: existing, ...(firstDefinition && notify(existing) && { warning: 'The word was saved, but the local mock API does not send word notifications.' }) });
  }
  const item = {
    word_id: req.body.word_id || uuidv4(),
    word: wordText,
    user_name: req.user.user_name,
    definition: (req.body.definition || '').trim(),
    new_word_1: (req.body.new_word_1 || '').trim().toLowerCase(),
    new_word_2: (req.body.new_word_2 || '').trim().toLowerCase(),
    previous_word_id: req.body.previous_word_id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    game_id: gameId
  };
  words.push(item);
  debugLog('POST /api/words created', item.word_id);
  res.json({ word: item, ...(item.definition && notify(item) && { warning: 'The word was saved, but the local mock API does not send word notifications.' }) });
});

app.post('/api/signup', (req, res) => {
  debugLog('POST /api/signup body keys', Object.keys(req.body || {}));
  const { user_name, password, researcher_name, researcher_bio, repeat_password } = req.body || {};
  const gameId = typeof req.body.game_id === 'string' ? normalizeGameId(req.body.game_id) : 'default';
  if (gameId === 'default') return res.status(400).json({ error: 'Please visit your game URL again before creating a profile; the Example Game does not accept signups.' });
  if (!games.some((game) => game.game_id === gameId)) return res.status(400).json({ error: 'Game not found. Please visit your game URL again before creating a profile.' });
  const existing = user_name && password ? profiles.find((profile) => profile.user_name === user_name) : null;
  if (existing) {
    if (!bcrypt.compareSync(password, existing.password_hash)) return res.status(409).json({ error: 'User already exists. To join this game with that account, enter its password.' });
    const current = withResearcher(existing, gameId);
    const joinedFields = { researcher_name: (researcher_name || '').trim() || current.researcher_name, researcher_bio: (researcher_bio || '').trim() || current.researcher_bio };
    saveResearcher(user_name, gameId, joinedFields);
    const token = jwt.sign({ user_name }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, joined: true, profile: { user_name, ...joinedFields, created_at: existing.created_at, updated_at: existing.updated_at } });
  }
  const email = normalizeEmail(req.body.email);
  if (email === null) return res.status(400).json({ error: 'Please enter a valid email address' });
  const preferences = getEmailPreferences(req.body);
  if (!preferences) return res.status(400).json({ error: 'Invalid email preferences' });
  if (!user_name || !password || !researcher_name || !researcher_bio || !repeat_password) {
    debugLog('POST /api/signup missing fields');
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password !== repeat_password) return res.status(400).json({ error: 'Passwords must match' });
  const passwordHash = bcrypt.hashSync(password, 12);
  const now = new Date().toISOString();
  const profile = { user_name, researcher_name, researcher_bio, email: email || '', ...preferences, password_hash: passwordHash, created_at: now, updated_at: now };
  profiles.push(profile);
  saveResearcher(user_name, gameId, { researcher_name, researcher_bio });
  const token = jwt.sign({ user_name }, JWT_SECRET, { expiresIn: '7d' });
  debugLog('POST /api/signup created', user_name);
  res.json({ token, profile: { user_name, researcher_name, researcher_bio, email: profile.email, ...preferences, created_at: now, updated_at: now }, ...(email && { warning: 'Your profile was saved, but the local mock API does not send welcome emails.' }) });
});

app.post('/api/login', (req, res) => {
  debugLog('POST /api/login attempt', Object.keys(req.body || {}));
  const { user_name, password } = req.body || {};
  const profile = profiles.find((entry) => entry.user_name === user_name);
  if (!profile || !bcrypt.compareSync(password || '', profile.password_hash)) {
    debugLog('POST /api/login failed', user_name);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = jwt.sign({ user_name }, JWT_SECRET, { expiresIn: '7d' });
  debugLog('POST /api/login success', user_name);
  res.json({ token, profile: { user_name, researcher_name: profile.researcher_name, researcher_bio: profile.researcher_bio, created_at: profile.created_at, updated_at: profile.updated_at } });
});

app.get('/api/profiles/:user_name', (req, res) => {
  debugLog('GET /api/profiles/:user_name', req.params.user_name);
  const profile = profiles.find((entry) => entry.user_name === req.params.user_name);
  if (!profile) {
    debugLog('GET /api/profiles not found', req.params.user_name);
    return res.status(404).json({ error: 'Profile not found' });
  }
  const gameId = normalizeGameId(req.query.game_id);
  const authoredWords = words.filter((word) => word.user_name === profile.user_name && word.game_id === gameId);
  debugLog('GET /api/profiles authoredWords', authoredWords.length);
  const token = (req.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  let user;
  if (token) {
    try { user = jwt.verify(token[1], JWT_SECRET); } catch (err) { debugLog('GET profile: invalid token', err.name); }
  }
  const ownEmail = user && user.user_name === profile.user_name ? { email: profile.email || '', ...getEmailPreferences({}, profile) } : {};
  const isOwnAdmin = user && user.user_name === profile.user_name && profile.admin === true;
  const game = isOwnAdmin ? games.find((entry) => entry.game_id === gameId) : null;
  const admin = isOwnAdmin ? { game: game ? { game_id: game.game_id, name: game.name || game.game_id, current_letter: game.current_letter || 'A', completed: game.completed === true } : null } : undefined;
  res.set('Cache-Control', 'no-store');
  res.json({ profile: { user_name: profile.user_name, ...withResearcher(profile, gameId), created_at: profile.created_at, updated_at: profile.updated_at, ...ownEmail }, words: authoredWords, ...(admin && { admin }) });
});

app.post('/api/admin/round', authMiddleware, (req, res) => {
  const profile = profiles.find((entry) => entry.user_name === req.user.user_name);
  if (!profile || profile.admin !== true) return res.status(403).json({ error: 'Forbidden' });
  const { game_id, current_letter } = req.body;
  if (typeof game_id !== 'string' || !game_id.trim() || typeof current_letter !== 'string' || !/^[A-Z]$/.test(current_letter)) {
    return res.status(400).json({ error: 'A game and current round are required' });
  }
  const game = games.find((entry) => entry.game_id === game_id.trim());
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const letter = game.current_letter || 'A';
  if (game.completed || letter !== current_letter) return res.status(409).json({ error: 'The round has changed or the game is complete. Refresh the profile.' });
  game.completed = letter === 'Z';
  game.current_letter = game.completed ? letter : String.fromCharCode(letter.charCodeAt(0) + 1);
  const recipients = profiles.filter((entry) => isMember(entry, game.game_id) && entry.email && entry.notify_round_complete === true);
  res.json({ game: { game_id: game.game_id, name: game.name || game.game_id, current_letter: game.current_letter, completed: game.completed },
    ...(recipients.length && { warning: 'The round ended, but the local mock API does not send round emails.' }) });
});

app.post('/api/profiles/', authMiddleware, updateProfile);
app.put('/api/profiles/:user_name', authMiddleware, updateProfile);

function updateProfile(req, res) {
  debugLog('PUT /api/profiles/:user_name updating', req.params.user_name);
  const profile = profiles.find((entry) => entry.user_name === (req.params.user_name || req.body.user_name));
  if (!profile) {
    debugLog('PUT /api/profiles not found', req.params.user_name);
    return res.status(404).json({ error: 'Profile not found' });
  }
  if (profile.user_name !== req.user.user_name) {
    debugLog('PUT /api/profiles forbidden', req.user && req.user.user_name);
    return res.status(403).json({ error: 'Forbidden' });
  }
  const email = normalizeEmail(req.body.email);
  if (email === null) return res.status(400).json({ error: 'Please enter a valid email address' });
  const previousPreferences = getEmailPreferences({}, profile);
  const preferences = getEmailPreferences(req.body, profile);
  if (!preferences) return res.status(400).json({ error: 'Invalid email preferences' });
  const savedEmail = email === undefined ? (profile.email || '') : email;
  const shouldSend = savedEmail && (savedEmail !== (profile.email || '') ||
    Object.keys(preferences).some((key) => preferences[key] !== previousPreferences[key]));
  const gameId = normalizeGameId(req.body.game_id);
  const perGame = typeof req.body.game_id === 'string' && gameId !== 'default';
  const nameFields = { researcher_name: req.body.researcher_name || withResearcher(profile, gameId).researcher_name, researcher_bio: req.body.researcher_bio || withResearcher(profile, gameId).researcher_bio };
  if (perGame) saveResearcher(profile.user_name, gameId, nameFields);
  const updated = { ...profile, ...(perGame ? {} : nameFields), updated_at: new Date().toISOString() };
  if (email !== undefined) updated.email = email;
  for (const key of Object.keys(preferences)) {
    if (req.body[key] !== undefined) updated[key] = preferences[key];
  }
  if (req.body.password) {
    updated.password_hash = bcrypt.hashSync(req.body.password, 12);
  }
  Object.assign(profile, updated);
  debugLog('PUT /api/profiles updated', profile.user_name);
  res.json({ profile: { user_name: profile.user_name, ...(perGame ? nameFields : { researcher_name: profile.researcher_name, researcher_bio: profile.researcher_bio }), email: profile.email || '', ...preferences, created_at: profile.created_at, updated_at: profile.updated_at }, ...(shouldSend && { warning: 'Your profile was saved, but the local mock API does not send welcome emails.' }) });
}

module.exports = app;
