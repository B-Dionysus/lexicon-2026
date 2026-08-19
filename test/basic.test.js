const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { normalizeGameId, parseAuthTokenFromHeader, resolveApiBase, getCurrentUserNameFromToken, decorateWordsWithResearcherNames } = require('../src/lib/utils');
const { createDataAccess } = require('../src/lib/dataAccess');
const handlerModule = require('../src/handler');
const { handler } = handlerModule;

function createMockDynamo({ getResult = { Item: null }, queryResult = { Items: [] }, batchGetResult = { Responses: {} }, updateResult = { Attributes: {} }, transactWriteResult = {}, putResult = {} } = {}) {
  const calls = [];
  return {
    calls,
    dynamodb: {
      get: (params) => ({ promise: async () => { calls.push({ op: 'get', params }); return getResult; } }),
      put: (params) => ({ promise: async () => { calls.push({ op: 'put', params }); return putResult; } }),
      query: (params) => ({ promise: async () => { calls.push({ op: 'query', params }); return queryResult; } }),
      batchGet: (params) => ({ promise: async () => { calls.push({ op: 'batchGet', params }); return batchGetResult; } }),
      update: (params) => ({ promise: async () => { calls.push({ op: 'update', params }); return updateResult; } }),
      transactWrite: (params) => ({ promise: async () => { calls.push({ op: 'transactWrite', params }); return transactWriteResult; } })
    }
  };
}

test('normalizeGameId returns default for missing values', () => {
  assert.equal(normalizeGameId(undefined), 'default');
  assert.equal(normalizeGameId(''), 'default');
});

test('parseAuthTokenFromHeader extracts bearer token', () => {
  assert.equal(parseAuthTokenFromHeader('Bearer abc123'), 'abc123');
  assert.equal(parseAuthTokenFromHeader('abc123'), null);
});

test('resolveApiBase uses the local mock API for local hosts', () => {
  assert.equal(resolveApiBase('localhost', 'https://example.test/Prod'), '/api');
  assert.equal(resolveApiBase('127.0.0.1', 'https://example.test/Prod'), '/api');
});

test('resolveApiBase preserves the provided production API base for remote hosts', () => {
  assert.equal(resolveApiBase('example.test', 'https://example.test/Prod'), 'https://example.test/Prod');
});

test('getCurrentUserNameFromToken extracts the logged-in username from a JWT payload', () => {
  const payload = Buffer.from(JSON.stringify({ user_name: 'researcher' })).toString('base64url');
  assert.equal(getCurrentUserNameFromToken(`header.${payload}.signature`), 'researcher');
  assert.equal(getCurrentUserNameFromToken(null), null);
});

test('decorateWordsWithResearcherNames adds researcher names to word results', () => {
  const words = [{ word_id: '1', word: 'alpha', user_name: 'user-1' }];
  const decorated = decorateWordsWithResearcherNames(words, { 'user-1': { researcher_name: 'Dr. Ada' } });

  assert.equal(decorated[0].researcher_name, 'Dr. Ada');
  assert.equal(decorated[0].user_name, 'user-1');
});

test('handler responds to OPTIONS with CORS headers', async () => {
  const response = await handler({ httpMethod: 'OPTIONS', path: '/' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
});

test('handler returns 404 for unsupported routes', async () => {
  const response = await handler({ httpMethod: 'GET', path: '/nope' });

  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).error, 'Path /nope not found');
});

test('handler routes stage-prefixed API paths correctly', async () => {
  const originalListWords = handlerModule.__test__.dataAccess.listWordsByGame;
  const originalGetProfiles = handlerModule.__test__.dataAccess.getProfilesByUserNames;
  const originalGetCacheSignal = handlerModule.__test__.dataAccess.getCacheSignal;

  handlerModule.__test__.dataAccess.listWordsByGame = async () => [
    { word_id: 'word-1', word: 'alpha', user_name: 'researcher', game_id: 'default' }
  ];
  handlerModule.__test__.dataAccess.getProfilesByUserNames = async () => [
    { user_name: 'researcher', researcher_name: 'Ada' }
  ];
  handlerModule.__test__.dataAccess.getCacheSignal = async () => null;

  const response = await handler({
    httpMethod: 'GET',
    rawPath: '/Prod/words',
    requestContext: { stage: 'Prod' },
    queryStringParameters: { game_id: 'default' }
  });

  handlerModule.__test__.dataAccess.listWordsByGame = originalListWords;
  handlerModule.__test__.dataAccess.getProfilesByUserNames = originalGetProfiles;
  handlerModule.__test__.dataAccess.getCacheSignal = originalGetCacheSignal;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.words.length, 1);
  assert.equal(payload.words[0].word, 'alpha');
});

test('createDataAccess batches profile reads for word lists', async () => {
  const { dynamodb, calls } = createMockDynamo({
    batchGetResult: { Responses: { 'lexicon-2026-profiles': [{ user_name: 'researcher', researcher_name: 'Ada' }] } }
  });
  const dataAccess = createDataAccess({
    dynamodb,
    tables: { words: 'lexicon-2026-words', games: 'lexicon-2026-games', profiles: 'lexicon-2026-profiles' },
    logger: () => {}
  });

  const profiles = await dataAccess.getProfilesByUserNames(['researcher', 'researcher']);

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].user_name, 'researcher');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, 'batchGet');
  assert.equal(calls[0].params.RequestItems['lexicon-2026-profiles'].Keys.length, 1);
});

test('createDataAccess listWordsByUserNameAndGame uses the profile index and sorts words', async () => {
  const { dynamodb, calls } = createMockDynamo({
    queryResult: { Items: [{ word: 'zeta', created_at: '2026-01-01' }, { word: 'alpha', created_at: '2026-01-02' }] }
  });
  const dataAccess = createDataAccess({
    dynamodb,
    tables: { words: 'lexicon-2026-words', games: 'lexicon-2026-games', profiles: 'lexicon-2026-profiles' },
    logger: () => {}
  });

  const words = await dataAccess.listWordsByUserNameAndGame('researcher', 'default');

  assert.equal(words.length, 2);
  assert.equal(words[0].word, 'alpha');
  assert.equal(words[1].word, 'zeta');
  assert.equal(calls[0].op, 'query');
  assert.equal(calls[0].params.IndexName, 'user_name-game_id-index');
});

test('createDataAccess createWordWithRelated writes transactionally', async () => {
  const { dynamodb, calls } = createMockDynamo({ transactWriteResult: {} });
  const dataAccess = createDataAccess({
    dynamodb,
    tables: { words: 'lexicon-2026-words', games: 'lexicon-2026-games', profiles: 'lexicon-2026-profiles', cacheSignals: 'lexicon-2026-cache-signals' },
    logger: () => {}
  });

  const item = { word_id: 'main' };
  const relatedItems = [{ word_id: 'child' }];
  await dataAccess.createWordWithRelated(item, relatedItems);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, 'transactWrite');
  assert.equal(calls[0].params.TransactItems.length, 2);
});

test('createDataAccess getCacheSignal returns the shared invalidation token', async () => {
  const { dynamodb, calls } = createMockDynamo({ getResult: { Item: { game_id: 'default', last_invalidated: '2026-01-01T00:00:00.000Z' } } });
  const dataAccess = createDataAccess({
    dynamodb,
    tables: { words: 'lexicon-2026-words', games: 'lexicon-2026-games', profiles: 'lexicon-2026-profiles', cacheSignals: 'lexicon-2026-cache-signals' },
    logger: () => {}
  });

  const signal = await dataAccess.getCacheSignal('default');
  assert.equal(signal, '2026-01-01T00:00:00.000Z');
  assert.equal(calls[0].op, 'get');
  assert.equal(calls[0].params.TableName, 'lexicon-2026-cache-signals');
});

test('createDataAccess touchCacheSignal writes the invalidation token', async () => {
  const { dynamodb, calls } = createMockDynamo({ putResult: {} });
  const dataAccess = createDataAccess({
    dynamodb,
    tables: { words: 'lexicon-2026-words', games: 'lexicon-2026-games', profiles: 'lexicon-2026-profiles', cacheSignals: 'lexicon-2026-cache-signals' },
    logger: () => {}
  });

  const result = await dataAccess.touchCacheSignal('default');
  assert.ok(typeof result === 'string');
  assert.ok(result.endsWith('Z'));
  assert.equal(calls[0].op, 'put');
  assert.equal(calls[0].params.TableName, 'lexicon-2026-cache-signals');
  assert.equal(calls[0].params.Item.game_id, 'default');
});

test('createDataAccess updateProfile constructs the expected update request', async () => {
  const { dynamodb, calls } = createMockDynamo({ updateResult: { Attributes: { user_name: 'researcher' } } });
  const dataAccess = createDataAccess({
    dynamodb,
    tables: { words: 'lexicon-2026-words', games: 'lexicon-2026-games', profiles: 'lexicon-2026-profiles' },
    logger: () => {}
  });

  await dataAccess.updateProfile('researcher', { researcher_name: 'Ada', researcher_bio: 'Bio' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, 'update');
  assert.match(calls[0].params.UpdateExpression, /#researcher_name = :researcher_name/);
  assert.match(calls[0].params.UpdateExpression, /#researcher_bio = :researcher_bio/);
});

test('handleGetProfile returns authored words using the profile index', async () => {
  const originalDataAccess = handlerModule.__test__.dataAccess;
  const originalGetProfile = originalDataAccess.getProfile;
  const originalList = originalDataAccess.listWordsByUserNameAndGame;

  let profileCalled = false;
  let listCalled = false;

  originalDataAccess.getProfile = async (userName) => {
    profileCalled = true;
    return {
      user_name: userName,
      researcher_name: 'Ada Lovelace',
      researcher_bio: 'Pioneer',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    };
  };

  originalDataAccess.listWordsByUserNameAndGame = async (userName, gameId) => {
    listCalled = true;
    assert.equal(userName, 'researcher');
    assert.equal(gameId, 'default');
    return [{
      word_id: 'word-1',
      word: 'alpha',
      user_name: 'researcher',
      definition: 'A test word',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      game_id: 'default'
    }];
  };

  const response = await handlerModule.handleGetProfile({
    pathParameters: { user_name: 'researcher' },
    queryStringParameters: { game_id: 'default' }
  });

  handlerModule.__test__.dataAccess.getProfile = originalGetProfile;
  handlerModule.__test__.dataAccess.listWordsByUserNameAndGame = originalList;

  assert.equal(profileCalled, true);
  assert.equal(listCalled, true);
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.profile.user_name, 'researcher');
  assert.equal(payload.words.length, 1);
  assert.equal(payload.words[0].word_id, 'word-1');
});

test('handleInvalidateCache clears a single game cache entry when authenticated', async () => {
  const originalTouchCacheSignal = handlerModule.__test__.dataAccess.touchCacheSignal;
  const token = 'Bearer ' + jwt.sign({ user_name: 'researcher' }, process.env.JWT_SECRET || 'dev-secret');
  handlerModule.__test__.dataAccess.touchCacheSignal = async () => '2026-01-01T00:00:00.000Z';
  handlerModule.__test__.wordListCache.set('default', { words: [], cachedAt: new Date().toISOString() });

  const response = await handlerModule.handleInvalidateCache({
    headers: { Authorization: token },
    queryStringParameters: { game_id: 'default' }
  });

  handlerModule.__test__.dataAccess.touchCacheSignal = originalTouchCacheSignal;
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.invalidated, 'default');
  assert.equal(handlerModule.__test__.wordListCache.has('default'), false);
});

test('handleInvalidateCache clears all cache entries when no game_id is provided', async () => {
  const token = 'Bearer ' + jwt.sign({ user_name: 'researcher' }, process.env.JWT_SECRET || 'dev-secret');
  handlerModule.__test__.wordListCache.set('default', { words: [], cachedAt: new Date().toISOString() });
  handlerModule.__test__.wordListCache.set('another', { words: [], cachedAt: new Date().toISOString() });

  const response = await handlerModule.handleInvalidateCache({
    headers: { Authorization: token }
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.invalidated, 'all');
  assert.equal(handlerModule.__test__.wordListCache.size, 0);
});

test('handleCreateWord writes the main word and related words transactionally', async () => {
  const originalDataAccess = handlerModule.__test__.dataAccess;
  const originalCreateWordWithRelated = originalDataAccess.createWordWithRelated;
  const originalTouchCacheSignal = originalDataAccess.touchCacheSignal;
  const originalListWordsByName = originalDataAccess.listWordsByName;

  let createCalled = false;
  let capturedArgs;

  originalDataAccess.createWordWithRelated = async (item, relatedItems, nameClaims) => {
    createCalled = true;
    capturedArgs = { item, relatedItems, nameClaims };
    return item;
  };
  originalDataAccess.touchCacheSignal = async () => '2026-01-01T00:00:00.000Z';
  originalDataAccess.listWordsByName = async () => [];

  handlerModule.__test__.clearWordListCache();
  handlerModule.__test__.wordListCache.set('default', { words: [], cachedAt: new Date().toISOString() });

  const token = 'Bearer ' + require('jsonwebtoken').sign({ user_name: 'researcher' }, process.env.JWT_SECRET || 'dev-secret');
  const response = await handlerModule.handleCreateWord({
    headers: { Authorization: token },
    body: JSON.stringify({
      word: 'Test',
      definition: 'A test word',
      new_word_1: 'child1',
      new_word_2: 'child2',
      game_id: 'default'
    })
  });

  handlerModule.__test__.dataAccess.createWordWithRelated = originalCreateWordWithRelated;
  handlerModule.__test__.dataAccess.touchCacheSignal = originalTouchCacheSignal;
  handlerModule.__test__.dataAccess.listWordsByName = originalListWordsByName;

  assert.equal(createCalled, true);
  assert.equal(handlerModule.__test__.wordListCache.has('default'), false);
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.word.word, 'test');
  assert.equal(payload.word.game_id, 'default');
  assert.equal(capturedArgs.relatedItems.length, 2);
  assert.equal(capturedArgs.nameClaims.length, 3);
  assert.equal(capturedArgs.item.user_name, 'researcher');
});

test('handleCreateWord rejects an existing related word before writing', async () => {
  const originalDataAccess = handlerModule.__test__.dataAccess;
  const originalListWordsByName = originalDataAccess.listWordsByName;
  const originalCreateWordWithRelated = originalDataAccess.createWordWithRelated;
  let createCalled = false;

  originalDataAccess.listWordsByName = async (_gameId, word) => word === 'apple' ? [{ word_id: 'apple-id', word: 'apple' }] : [];
  originalDataAccess.createWordWithRelated = async () => { createCalled = true; };

  const token = 'Bearer ' + jwt.sign({ user_name: 'researcher' }, process.env.JWT_SECRET || 'dev-secret');
  const response = await handlerModule.handleCreateWord({
    headers: { Authorization: token },
    body: JSON.stringify({ word: 'fruit', new_word_1: 'apple', game_id: 'default' })
  });

  originalDataAccess.listWordsByName = originalListWordsByName;
  originalDataAccess.createWordWithRelated = originalCreateWordWithRelated;

  assert.equal(response.statusCode, 409);
  assert.equal(createCalled, false);
});

test('handleGetWords returns a cached word list on second call', async () => {
  const originalListWords = handlerModule.__test__.dataAccess.listWordsByGame;
  const originalGetCacheSignal = handlerModule.__test__.dataAccess.getCacheSignal;

  let listCalls = 0;
  handlerModule.__test__.dataAccess.listWordsByGame = async () => {
    listCalls += 1;
    return [{ word_id: 'word-1', word: 'alpha', user_name: 'researcher', game_id: 'default' }];
  };
  handlerModule.__test__.dataAccess.getCacheSignal = async () => 'token-1';

  handlerModule.__test__.clearWordListCache();

  await handlerModule.handleGetWords({ queryStringParameters: { game_id: 'default' } });
  await handlerModule.handleGetWords({ queryStringParameters: { game_id: 'default' } });

  handlerModule.__test__.dataAccess.listWordsByGame = originalListWords;
  handlerModule.__test__.dataAccess.getCacheSignal = originalGetCacheSignal;

  assert.equal(listCalls, 1);
});

test('handleGetWords refreshes cached word list when shared signal changes', async () => {
  const originalListWords = handlerModule.__test__.dataAccess.listWordsByGame;
  const originalGetCacheSignal = handlerModule.__test__.dataAccess.getCacheSignal;

  let listCalls = 0;
  const signalValues = ['old-token', 'new-token'];

  handlerModule.__test__.dataAccess.listWordsByGame = async () => {
    listCalls += 1;
    return [{ word_id: 'word-1', word: 'alpha', user_name: 'researcher', game_id: 'default' }];
  };
  handlerModule.__test__.dataAccess.getCacheSignal = async () => signalValues.shift();

  handlerModule.__test__.clearWordListCache();

  await handlerModule.handleGetWords({ queryStringParameters: { game_id: 'default' } });
  await handlerModule.handleGetWords({ queryStringParameters: { game_id: 'default' } });

  handlerModule.__test__.dataAccess.listWordsByGame = originalListWords;
  handlerModule.__test__.dataAccess.getCacheSignal = originalGetCacheSignal;

  assert.equal(listCalls, 2);
});

test('handleUpdateWord invalidates the cached word list when a word changes', async () => {
  const originalGetWord = handlerModule.__test__.dataAccess.getWord;
  const originalUpdateWord = handlerModule.__test__.dataAccess.updateWord;
  const originalTouchCacheSignal = handlerModule.__test__.dataAccess.touchCacheSignal;

  handlerModule.__test__.dataAccess.getWord = async () => ({ word_id: 'word-1', user_name: 'researcher', game_id: 'default' });
  handlerModule.__test__.dataAccess.updateWord = async (wordId, updates) => ({ word_id: wordId, ...updates });
  handlerModule.__test__.dataAccess.touchCacheSignal = async () => '2026-01-01T00:00:00.000Z';

  handlerModule.__test__.clearWordListCache();
  handlerModule.__test__.wordListCache.set('default', { words: [], cachedAt: new Date().toISOString() });

  const token = 'Bearer ' + jwt.sign({ user_name: 'researcher' }, process.env.JWT_SECRET || 'dev-secret');
  const response = await handlerModule.handleUpdateWord({
    headers: { Authorization: token },
    pathParameters: { word_id: 'word-1' },
    body: JSON.stringify({ definition: 'Updated definition' })
  });

  handlerModule.__test__.dataAccess.getWord = originalGetWord;
  handlerModule.__test__.dataAccess.updateWord = originalUpdateWord;
  handlerModule.__test__.dataAccess.touchCacheSignal = originalTouchCacheSignal;

  assert.equal(response.statusCode, 200);
  assert.equal(handlerModule.__test__.wordListCache.has('default'), false);
});

test('handleSignup creates a new profile and returns a token', async () => {
  const originalGetProfile = handlerModule.__test__.dataAccess.getProfile;
  const originalPut = handlerModule.__test__.dynamodb.put;

  handlerModule.__test__.dataAccess.getProfile = async () => null;
  handlerModule.__test__.dynamodb.put = (params) => ({ promise: async () => ({}) });

  const response = await handlerModule.handleSignup({
    body: JSON.stringify({
      user_name: 'researcher',
      password: 'password123',
      repeat_password: 'password123',
      researcher_name: 'Ada',
      researcher_bio: 'Pioneer'
    })
  });

  handlerModule.__test__.dataAccess.getProfile = originalGetProfile;
  handlerModule.__test__.dynamodb.put = originalPut;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.profile.user_name, 'researcher');
  assert.equal(typeof payload.token, 'string');
});

test('handleLogin validates credentials and returns a token', async () => {
  const hashedPassword = bcrypt.hashSync('password123', 12);
  const originalGetProfile = handlerModule.__test__.dataAccess.getProfile;
  handlerModule.__test__.dataAccess.getProfile = async () => ({
    user_name: 'researcher',
    password_hash: hashedPassword,
    researcher_name: 'Ada',
    researcher_bio: 'Pioneer',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  });

  const response = await handlerModule.handleLogin({
    body: JSON.stringify({ user_name: 'researcher', password: 'password123' })
  });

  handlerModule.__test__.dataAccess.getProfile = originalGetProfile;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.profile.user_name, 'researcher');
  assert.equal(typeof payload.token, 'string');
});

test('handleGetWords returns words decorated with researcher names', async () => {
  const originalListWords = handlerModule.__test__.dataAccess.listWordsByGame;
  const originalGetProfiles = handlerModule.__test__.dataAccess.getProfilesByUserNames;
  const originalGetCacheSignal = handlerModule.__test__.dataAccess.getCacheSignal;

  handlerModule.__test__.dataAccess.listWordsByGame = async () => [
    { word_id: 'word-1', word: 'alpha', user_name: 'researcher', game_id: 'default' }
  ];
  handlerModule.__test__.dataAccess.getProfilesByUserNames = async () => [
    { user_name: 'researcher', researcher_name: 'Ada' }
  ];
  handlerModule.__test__.dataAccess.getCacheSignal = async () => null;

  const response = await handlerModule.handleGetWords({ queryStringParameters: { game_id: 'default' } });

  handlerModule.__test__.dataAccess.listWordsByGame = originalListWords;
  handlerModule.__test__.dataAccess.getProfilesByUserNames = originalGetProfiles;
  handlerModule.__test__.dataAccess.getCacheSignal = originalGetCacheSignal;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.words.length, 1);
  assert.equal(payload.words[0].researcher_name, 'Ada');
});

test('handleGetWord returns a word with researcher name and previous word', async () => {
  const originalGetWord = handlerModule.__test__.dataAccess.getWord;
  const originalGetProfile = handlerModule.__test__.dataAccess.getProfile;

  handlerModule.__test__.dataAccess.getWord = async (wordId) => {
    if (wordId === 'word-1') {
      return { word_id: 'word-1', word: 'alpha', user_name: 'researcher', previous_word_id: 'word-2' };
    }
    return { word_id: 'word-2', word: 'beta' };
  };
  handlerModule.__test__.dataAccess.getProfile = async () => ({ researcher_name: 'Ada' });

  const response = await handlerModule.handleGetWord({ pathParameters: { word_id: 'word-1' } });

  handlerModule.__test__.dataAccess.getWord = originalGetWord;
  handlerModule.__test__.dataAccess.getProfile = originalGetProfile;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.word.word, 'alpha');
  assert.equal(payload.word.researcher_name, 'Ada');
  assert.equal(payload.word.previous_word.word, 'beta');
});

test('handleUpdateWord updates a word if the user is authorized', async () => {
  const originalGetWord = handlerModule.__test__.dataAccess.getWord;
  const originalUpdateWord = handlerModule.__test__.dataAccess.updateWord;

  handlerModule.__test__.dataAccess.getWord = async () => ({ word_id: 'word-1', user_name: 'researcher' });
  handlerModule.__test__.dataAccess.updateWord = async (wordId, updates) => ({ word_id: wordId, ...updates });

  const token = 'Bearer ' + jwt.sign({ user_name: 'researcher' }, process.env.JWT_SECRET || 'dev-secret');
  const response = await handlerModule.handleUpdateWord({
    headers: { Authorization: token },
    pathParameters: { word_id: 'word-1' },
    body: JSON.stringify({ definition: 'Updated definition' })
  });

  handlerModule.__test__.dataAccess.getWord = originalGetWord;
  handlerModule.__test__.dataAccess.updateWord = originalUpdateWord;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.word.word_id, 'word-1');
  assert.equal(payload.word.definition, 'Updated definition');
});

test('handleGetGame returns game metadata', async () => {
  const originalGetGame = handlerModule.__test__.dataAccess.getGame;
  handlerModule.__test__.dataAccess.getGame = async () => ({ game_id: 'default', subtitle: 'Test game' });

  const response = await handlerModule.handleGetGame({ queryStringParameters: { game_id: 'default' } });

  handlerModule.__test__.dataAccess.getGame = originalGetGame;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.game.subtitle, 'Test game');
});

test('handleUpdateProfile updates profile metadata and returns updated profile', async () => {
  const originalGetProfile = handlerModule.__test__.dataAccess.getProfile;
  const originalUpdateProfile = handlerModule.__test__.dataAccess.updateProfile;

  handlerModule.__test__.dataAccess.getProfile = async () => ({
    user_name: 'researcher',
    researcher_name: 'Ada',
    researcher_bio: 'Pioneer',
    password_hash: bcrypt.hashSync('password123', 12)
  });
  handlerModule.__test__.dataAccess.updateProfile = async (userName, updates) => {
    assert.equal(userName, 'researcher');
    assert.equal(updates.researcher_name, 'Ada Changed');
    assert.equal(updates.researcher_bio, 'Changed bio');
    assert.ok(updates.password_hash);
  };

  const token = 'Bearer ' + jwt.sign({ user_name: 'researcher' }, process.env.JWT_SECRET || 'dev-secret');
  const response = await handlerModule.handleUpdateProfile({
    headers: { Authorization: token },
    body: JSON.stringify({
      user_name: 'researcher',
      researcher_name: 'Ada Changed',
      researcher_bio: 'Changed bio',
      password: 'newpassword123',
      repeat_password: 'newpassword123'
    })
  });

  handlerModule.__test__.dataAccess.getProfile = originalGetProfile;
  handlerModule.__test__.dataAccess.updateProfile = originalUpdateProfile;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.profile.user_name, 'researcher');
  assert.equal(payload.profile.researcher_name, 'Ada Changed');
});
