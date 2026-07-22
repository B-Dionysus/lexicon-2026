const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { normalizeGameId, decorateWordsWithResearcherNames } = require('./lib/utils');

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
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

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

app.get('/api/words', (req, res) => {
  // Return list of words for a game
  const gameId = normalizeGameId(req.query.game_id);
  debugLog('/api/words: gameId', gameId);
  const filtered = words.filter((word) => word.game_id === gameId);
  filtered.sort((a, b) => a.word.localeCompare(b.word) || (a.created_at || '').localeCompare(b.created_at || ''));
  const profilesByUserName = Object.fromEntries(profiles.map((profile) => [profile.user_name, profile]));
  debugLog('/api/words: count', filtered.length);
  res.json({ words: decorateWordsWithResearcherNames(filtered, profilesByUserName) });
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
  res.json({ word: item });
});

app.post('/api/signup', (req, res) => {
  debugLog('POST /api/signup body keys', Object.keys(req.body || {}));
  const { user_name, password, researcher_name, researcher_bio, repeat_password } = req.body || {};
  if (!user_name || !password || !researcher_name || !researcher_bio || !repeat_password) {
    debugLog('POST /api/signup missing fields');
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (password !== repeat_password) return res.status(400).json({ error: 'Passwords must match' });
  if (profiles.some((profile) => profile.user_name === user_name)) return res.status(409).json({ error: 'User already exists' });
  const passwordHash = bcrypt.hashSync(password, 12);
  const now = new Date().toISOString();
  const profile = { user_name, researcher_name, researcher_bio, password_hash: passwordHash, created_at: now, updated_at: now };
  profiles.push(profile);
  const token = jwt.sign({ user_name }, JWT_SECRET, { expiresIn: '7d' });
  debugLog('POST /api/signup created', user_name);
  res.json({ token, profile: { user_name, researcher_name, researcher_bio, created_at: now, updated_at: now } });
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
  res.json({ profile: { user_name: profile.user_name, researcher_name: profile.researcher_name, researcher_bio: profile.researcher_bio, created_at: profile.created_at, updated_at: profile.updated_at }, words: authoredWords });
});

app.put('/api/profiles/:user_name', authMiddleware, (req, res) => {
  debugLog('PUT /api/profiles/:user_name updating', req.params.user_name);
  const profile = profiles.find((entry) => entry.user_name === req.params.user_name);
  if (!profile) {
    debugLog('PUT /api/profiles not found', req.params.user_name);
    return res.status(404).json({ error: 'Profile not found' });
  }
  if (profile.user_name !== req.user.user_name) {
    debugLog('PUT /api/profiles forbidden', req.user && req.user.user_name);
    return res.status(403).json({ error: 'Forbidden' });
  }
  const updated = { ...profile, ...req.body, updated_at: new Date().toISOString() };
  if (req.body.password) {
    updated.password_hash = bcrypt.hashSync(req.body.password, 12);
  }
  Object.assign(profile, updated);
  debugLog('PUT /api/profiles updated', profile.user_name);
  res.json({ profile: { user_name: profile.user_name, researcher_name: profile.researcher_name, researcher_bio: profile.researcher_bio, created_at: profile.created_at, updated_at: profile.updated_at } });
});

module.exports = app;
