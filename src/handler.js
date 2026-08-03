const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchGetCommand,
  UpdateCommand,
  TransactWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const {
  normalizeGameId,
  parseAuthTokenFromHeader,
  decorateWordsWithResearcherNames,
  extractBody,
  success,
  error
} = require('./lib/utils');
const { createDataAccess } = require('./lib/dataAccess');

function createDynamoDbAdapter(documentClient) {
  return {
    get(params) {
      return {
        promise: async () => documentClient.send(new GetCommand(params))
      };
    },
    put(params) {
      return {
        promise: async () => documentClient.send(new PutCommand(params))
      };
    },
    batchGet(params) {
      return {
        promise: async () => documentClient.send(new BatchGetCommand(params))
      };
    },
    query(params) {
      return {
        promise: async () => documentClient.send(new QueryCommand(params))
      };
    },
    update(params) {
      return {
        promise: async () => documentClient.send(new UpdateCommand(params))
      };
    },
    transactWrite(params) {
      return {
        promise: async () => documentClient.send(new TransactWriteCommand(params))
      };
    }
  };
}

const dynamodb = createDynamoDbAdapter(DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })));
const TABLE_WORDS = process.env.WORDS_TABLE || 'lexicon-2026-words';
const TABLE_GAMES = process.env.GAMES_TABLE || 'lexicon-2026-games';
const TABLE_PROFILES = process.env.PROFILES_TABLE || 'lexicon-2026-profiles';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Debug helper: unified logging prefix for Lambda
function debugLog(...args) {
  try {
    console.log('[LAMBDA DEBUG]', ...args);
  } catch (e) {
    // ignore logging errors
  }
}

debugLog('handler.js loaded', { envRegion: process.env.AWS_REGION, TABLE_WORDS, TABLE_PROFILES });

const dataAccess = createDataAccess({
  dynamodb,
  tables: {
    words: TABLE_WORDS,
    games: TABLE_GAMES,
    profiles: TABLE_PROFILES
  },
  logger: debugLog
});

function getCurrentUser(event) {
  // Parse and verify JWT from incoming request headers
  const token = parseAuthTokenFromHeader(event.headers && (event.headers.Authorization || event.headers.authorization));
  debugLog('getCurrentUser: parsed token', !!token);
  if (!token) return null;
  try {
    const user = jwt.verify(token, JWT_SECRET);
    debugLog('getCurrentUser: token verified', user && user.user_name);
    return user;
  } catch (err) {
    debugLog('getCurrentUser: token verify failed', err && err.message);
    return null;
  }
}

async function getProfile(userName) {
  return dataAccess.getProfile(userName);
}

async function listWordsByGame(gameId) {
  return dataAccess.listWordsByGame(gameId);
}

async function getWord(wordId) {
  return dataAccess.getWord(wordId);
}

async function getGame(gameId) {
  return dataAccess.getGame(gameId);
}

async function createWord(item, relatedItems = []) {
  return dataAccess.createWordWithRelated(item, relatedItems);
}

async function updateWord(wordId, updates) {
  return dataAccess.updateWord(wordId, updates);
}

async function handleSignup(event) {
  const body = extractBody(event);
  const { user_name, password, researcher_name, researcher_bio, repeat_password } = body;
  if (!user_name || !password || !researcher_name || !researcher_bio || !repeat_password) {
    return error('All fields are required', 400);
  }
  if (password.length < 8) return error('Password must be at least 8 characters', 400);
  if (password !== repeat_password) return error('Passwords must match', 400);
  const existing = await getProfile(user_name);
  if (existing) return error('User already exists', 409);
  const passwordHash = bcrypt.hashSync(password, 12);
  const now = new Date().toISOString();
  const profile = {
    user_name,
    researcher_name,
    researcher_bio,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now
  };
  await dynamodb.put({ TableName: TABLE_PROFILES, Item: profile, ConditionExpression: 'attribute_not_exists(user_name)' }).promise();
  const token = jwt.sign({ user_name }, JWT_SECRET, { expiresIn: '7d' });
  return success({ token, profile: { user_name, researcher_name, researcher_bio, created_at: now, updated_at: now } });
}

async function handleLogin(event) {
  const body = extractBody(event);
  const { user_name, password } = body;
  if (!user_name || !password) return error('Invalid username or password', 400);
  const profile = await getProfile(user_name);
  if (!profile || !profile.password_hash) return error('Invalid username or password', 401);
  const valid = bcrypt.compareSync(password, profile.password_hash);
  if (!valid) return error('Invalid username or password', 401);
  const token = jwt.sign({ user_name }, JWT_SECRET, { expiresIn: '7d' });
  return success({ token, profile: { user_name, researcher_name: profile.researcher_name, researcher_bio: profile.researcher_bio, created_at: profile.created_at, updated_at: profile.updated_at } });
}

async function handleGetWords(event) {
  const gameId = normalizeGameId(event.queryStringParameters && event.queryStringParameters.game_id);
  const words = await listWordsByGame(gameId);
  const profiles = await dataAccess.getProfilesByUserNames((words || []).map((word) => word.user_name));
  const profilesByUserName = Object.fromEntries(profiles.filter(Boolean).map((profile) => [profile.user_name, profile]));
  return success({ words: decorateWordsWithResearcherNames(words, profilesByUserName) });
}

async function handleGetWord(event) {
  let wordId = null;
  // 1. Check if we have the greedy proxy path string
  if (event.pathParameters && event.pathParameters.proxy) {
    // Splits "words/7ec8722b..." into an array and grabs the last element
    wordId = event.pathParameters.proxy.split('/').pop();
  } 
  // 2. Fallback check for standard parameter mappings or query parameters
  else {
    wordId = (event.pathParameters && (event.pathParameters.word_id || event.pathParameters.wordId)) || 
             (event.queryStringParameters && event.queryStringParameters.word_id);
  }           
  if (!wordId) {
    return error('word_id is required', 400);
  }
  const word = await getWord(wordId);
  if (!word) {
    return error('Word not found', 404);
  }
  const previousWord = word.previous_word_id ? await getWord(word.previous_word_id) : null;
  const profile = await getProfile(word.user_name);
  debugLog("Profile: ", profile)
  var researcher_name = "TBD";
  if(profile?.researcher_name) researcher_name = profile?.researcher_name;
  debugLog("Profile: ", researcher_name)
  return success({ 
    word: { 
      ...word,
      researcher_name, 
      previous_word: previousWord ? { word_id: previousWord.word_id, word: previousWord.word } : null 
    } 
  });
}

async function handleCreateWord(event) {
  const user = getCurrentUser(event);
  if (!user) return error('Authentication required', 401);
  const body = extractBody(event);
  debugLog('body=', body);
  const wordText = (body.word || '').trim().toLowerCase();
  if (!wordText) return error('Word is required', 400);
  const gameId = normalizeGameId(body.game_id || (event.queryStringParameters && event.queryStringParameters.game_id));
  const wordId = body.word_id || uuidv4();
  const now = new Date().toISOString();
  const new_1 = (body.new_word_1 || '').trim().toLowerCase();
  const new_2 = (body.new_word_2 || '').trim().toLowerCase();
  const new_1_uuid = uuidv4();
  const new_2_uuid = uuidv4();
  const relatedItems = [];

  if (typeof new_1 === 'string' && new_1.length > 0) {
    relatedItems.push({
      word_id: new_1_uuid,
      word: new_1,
      user_name: user.user_name,
      definition: '',
      new_word_1: '',
      new_word_2: '',
      new_word_1_id: uuidv4(),
      new_word_2_id: uuidv4(),
      previous_word_id: wordId,
      created_at: now,
      updated_at: now,
      game_id: gameId
    });
  }

  if (typeof new_2 === 'string' && new_2.length > 0) {
    relatedItems.push({
      word_id: new_2_uuid,
      word: new_2,
      user_name: user.user_name,
      definition: '',
      new_word_1: '',
      new_word_2: '',
      new_word_1_id: uuidv4(),
      new_word_2_id: uuidv4(),
      previous_word_id: wordId,
      created_at: now,
      updated_at: now,
      game_id: gameId
    });
  }

  const item = {
    word_id: wordId,
    word: wordText,
    user_name: user.user_name,
    definition: body.definition || '',
    new_word_1: new_1,
    new_word_2: new_2,
    new_word_1_id: new_1_uuid,
    new_word_2_id: new_2_uuid,
    previous_word_id: body.previous_word_id || null,
    created_at: now,
    updated_at: now,
    game_id: gameId
  };
  await createWord(item, relatedItems);
  return success({ word: item });
}

async function handleUpdateWord(event) {
  const user = getCurrentUser(event);
  if (!user) return error('Authentication required', 401);
  const body = extractBody(event);
  const wordId = event.pathParameters && event.pathParameters.word_id;
  if (!wordId) return error('word_id is required', 400);
  const existing = await getWord(wordId);
  if (!existing) return error('Word not found', 404);
  if (existing.user_name !== user.user_name) return error('Forbidden', 403);
  const updates = {
    definition: body.definition || '',
    updated_at: new Date().toISOString()
  };
  const updated = await updateWord(wordId, updates);
  return success({ word: updated });
}

async function handleGetProfile(event) {
  let userName = event.pathParameters && event.pathParameters.user_name;
  if (!userName) {
    const path = event.path || event.rawPath || '';
    const m = path.match(/\/profiles\/([^\/\?]+)/);
    if (m) userName = decodeURIComponent(m[1]);
  }
  if (!userName) return error('user_name is required', 400);
  const profile = await getProfile(userName);
  if (!profile) return error('Profile not found', 404);
  const gameId = normalizeGameId(event.queryStringParameters && event.queryStringParameters.game_id);
  const authoredWords = await dataAccess.listWordsByUserNameAndGame(userName, gameId);
  return success({ profile: { user_name: profile.user_name, researcher_name: profile.researcher_name, researcher_bio: profile.researcher_bio, created_at: profile.created_at, updated_at: profile.updated_at }, words: authoredWords });
}

async function handleGetGame(event) {
  debugLog('in handleGetGame, event=', event.queryStringParameters?.game_id);
  const gameId = normalizeGameId(event.queryStringParameters?.game_id);
  if (!gameId) return error('game_id is required', 400);
  debugLog('calling getgame with gameId=', gameId);
  const data = await getGame(gameId);
  debugLog('data=', data);
  const subtitle = data && data.subtitle ? data.subtitle : '';
  return success({ game: { game_id: gameId, subtitle } });
}

async function handleUpdateProfile(event) {
  const user = getCurrentUser(event);
  if (!user) return error('Authentication required', 401);
  const body = extractBody(event);
  const userName = body.user_name;
  debugLog("body=", body)
  debugLog("event=", event)
  if (!userName) return error('user_name is required', 400);
  const existing = await getProfile(userName);
  if (!existing) return error('Profile not found', 404);
  if (existing.user_name !== user.user_name) return error('Forbidden', 403);
  const updates = {
    researcher_name: body.researcher_name || existing.researcher_name,
    researcher_bio: body.researcher_bio || existing.researcher_bio,
    updated_at: new Date().toISOString()
  };
  if (body.password) {
    if (body.password.length < 8) return error('Password must be at least 8 characters', 400);
    if (body.password !== body.repeat_password) return error('Passwords must match', 400);
    updates.password_hash = bcrypt.hashSync(body.password, 12);
  }
  await dataAccess.updateProfile(userName, updates);
  return success({ profile: { user_name: userName, researcher_name: updates.researcher_name, researcher_bio: updates.researcher_bio, updated_at: updates.updated_at } });
}

async function route(event) {
  const method = event.httpMethod || event.requestContext && event.requestContext.httpMethod;
  const path = event.rawPath || event.path || '';
  debugLog('route: incoming', { method, path });
  if (method === 'OPTIONS') {
    return success({});
  }
  if (method === 'GET' && path === '/game') {
    return handleGetGame(event);
  }
  if (method === 'GET' && path === '/words') {
    return handleGetWords(event);
  }
  if (method === 'GET' && path.startsWith('/words/')) {
    return handleGetWord(event);
  }
  if (method === 'POST' && path === '/words') {
    return handleCreateWord(event);
  }
  if (method === 'PUT' && path.startsWith('/words/')) {
    return handleUpdateWord(event);
  }
  if (method === 'POST' && path === '/signup') {
    return handleSignup(event);
  }
  if (method === 'POST' && path === '/login') {
    return handleLogin(event);
  }
  if (method === 'GET' && path.startsWith('/profiles/')) {
    return handleGetProfile(event);
  }
  if ((method === 'PUT' || method === 'POST') && path.startsWith('/profiles/')) {
    return handleUpdateProfile(event);
  }
  return error("Path "+path+" not found", 404);
}

exports.handler = async (event) => {
  try {
    return await route(event);
  } catch (err) {
    debugLog('handler caught error', err && err.message);
    console.error('[LAMBDA ERROR]', err);
    return error(err.message || 'Internal server error', 500);
  }
};

exports.handleSignup = handleSignup;
exports.handleLogin = handleLogin;
exports.handleGetWords = handleGetWords;
exports.handleGetWord = handleGetWord;
exports.handleCreateWord = handleCreateWord;
exports.handleUpdateWord = handleUpdateWord;
exports.handleGetProfile = handleGetProfile;
exports.handleGetGame = handleGetGame;
exports.handleUpdateProfile = handleUpdateProfile;
exports.__test__ = {
  dataAccess,
  dynamodb
};
