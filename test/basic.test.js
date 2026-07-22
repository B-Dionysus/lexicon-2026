const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGameId, parseAuthTokenFromHeader, resolveApiBase, getCurrentUserNameFromToken, decorateWordsWithResearcherNames } = require('../src/lib/utils');
const { handler } = require('../src/handler');

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
