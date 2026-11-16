const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { SESClient } = require('@aws-sdk/client-ses');
const handler = require('../src/handler');
const { createDataAccess } = require('../src/lib/dataAccess');
const { wordEmail } = require('../src/lib/email');

const access = handler.__test__.dataAccess;
const headers = { Authorization: `Bearer ${jwt.sign({ user_name: 'writer' }, process.env.JWT_SECRET || 'dev-secret')}` };

test('word email uses requested copy, escaped linked names and game-specific URLs', async (t) => {
  const previous = { email: process.env.EMAIL_FROM, site: process.env.SITE_URL };
  process.env.EMAIL_FROM = 'sender@example.com';
  process.env.SITE_URL = 'https://example.test';
  t.after(() => {
    if (previous.email === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = previous.email;
    if (previous.site === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previous.site;
  });
  const send = t.mock.method(SESClient.prototype, 'send', async () => ({}));
  await wordEmail.send('reader@example.com', 'Example', 'Ada & Co', { word_id: 'word 1', game_id: 'a&b', user_name: 'writer & co', word: '<word>' });
  const email = send.mock.calls[0].arguments[0].input;
  assert.deepEqual(email.Destination.ToAddresses, ['reader@example.com']);
  assert.equal(email.Message.Subject.Data, '[Lexicon] Example Ada & Co has added a new word to the lexicon!');
  assert.equal(email.Message.Body.Html.Data, 'Good news! Another word has been added to the Lexicon: <a href="https://example.test/defined-word.html?word_id=word+1&amp;game_id=a%26b">&lt;word&gt;</a> created by <a href="https://example.test/profile.html?user_name=writer+%26+co&amp;game_id=a%26b">Ada &amp; Co</a>');
  assert.match(email.Message.Body.Text.Data, /defined-word\.html\?word_id=word\+1&game_id=a%26b/);
});

test('recipient scan selects only opted-in profiles for the specified game across pages', async () => {
  const calls = [];
  const db = { scan: (params) => ({ promise: async () => {
    calls.push(params);
    return calls.length === 1 ? { Items: [{ email: 'one@example.com' }], LastEvaluatedKey: { user_name: 'one' } } : { Items: [{ email: '' }, { email: 'two@example.com' }] };
  } }) };
  const data = createDataAccess({ dynamodb: db, tables: { profiles: 'profiles' } });
  assert.deepEqual((await data.listWordRecipients('game')).map((profile) => profile.email), ['one@example.com', 'two@example.com']);
  assert.equal(calls[0].ExpressionAttributeNames['#preference'], 'notify_word_created');
  assert.equal(calls[0].ExpressionAttributeValues[':gameId'], 'game');
  assert.equal(calls[0].ExpressionAttributeValues[':enabled'], true);
  assert.deepEqual(calls[1].ExclusiveStartKey, { user_name: 'one' });
});

test('new word sends once per opted-in recipient after saving and warns on partial failure', async (t) => {
  let saved = false;
  t.mock.method(access, 'listWordsByName', async () => []);
  t.mock.method(access, 'createWordWithRelated', async () => { saved = true; });
  t.mock.method(access, 'touchCacheSignal', async () => {});
  t.mock.method(access, 'listWordRecipients', async (gameId) => {
    assert.equal(gameId, 'game');
    assert.equal(saved, true);
    return [{ email: 'one@example.com' }, { email: 'two@example.com' }];
  });
  t.mock.method(access, 'getGame', async () => ({ name: 'Example' }));
  t.mock.method(access, 'getProfile', async () => ({ researcher_name: 'Ada' }));
  const send = t.mock.method(wordEmail, 'send', async (address) => {
    if (address === 'two@example.com') throw new Error('SES unavailable');
  });
  const response = await handler.handleCreateWord({ headers, body: JSON.stringify({ game_id: 'game', word: 'Alpha', definition: 'A definition', new_word_1: 'beta' }) });
  const result = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(result.word.word, 'alpha');
  assert.match(result.warning, /1 notification email/);
  assert.equal(send.mock.calls.length, 2);
  assert.equal(send.mock.calls[0].arguments[1], 'Example');
  assert.equal(send.mock.calls[0].arguments[2], 'Ada');
  assert.equal(send.mock.calls[0].arguments[3].word_id, result.word.word_id);
});

test('concurrent first definitions notify once; later edits do not notify', async (t) => {
  let stored = { word_id: 'id', game_id: 'game', word: 'alpha', user_name: 'writer', definition: '' };
  t.mock.method(access, 'getWord', async () => ({ ...stored }));
  t.mock.method(access, 'updateWord', async (_id, updates, options) => {
    if (options && stored.definition !== options.expectedDefinition) {
      const error = new Error('stale'); error.name = 'ConditionalCheckFailedException'; throw error;
    }
    stored = { ...stored, ...updates };
    return { ...stored };
  });
  t.mock.method(access, 'touchCacheSignal', async () => {});
  t.mock.method(access, 'listWordRecipients', async () => [{ email: 'reader@example.com' }]);
  t.mock.method(access, 'getGame', async () => ({ name: 'Example' }));
  t.mock.method(access, 'getProfile', async () => ({ researcher_name: 'Ada' }));
  const send = t.mock.method(wordEmail, 'send', async () => {});
  const request = () => handler.handleCreateWord({ headers, body: JSON.stringify({ word_id: 'id', word: 'alpha', definition: 'First definition' }) });
  assert.deepEqual((await Promise.all([request(), request()])).map((response) => response.statusCode), [200, 200]);
  assert.equal(send.mock.calls.length, 1);
  await handler.handleUpdateWord({ headers, pathParameters: { word_id: 'id' }, body: JSON.stringify({ definition: 'Edited definition' }) });
  assert.equal(send.mock.calls.length, 1);
});

test('notification preparation failure warns without undoing the word', async (t) => {
  t.mock.method(access, 'listWordsByName', async () => []);
  let saved = false;
  t.mock.method(access, 'createWordWithRelated', async () => { saved = true; });
  t.mock.method(access, 'touchCacheSignal', async () => {});
  t.mock.method(access, 'listWordRecipients', async () => { throw new Error('Database unavailable'); });
  const result = await handler.handleCreateWord({ headers, body: JSON.stringify({ game_id: 'game', word: 'alpha', definition: 'Definition' }) });
  assert.equal(result.statusCode, 200);
  assert.equal(saved, true);
  assert.match(JSON.parse(result.body).warning, /notification emails could not be sent/);
});

test('first-definition conditional update compares the original definition', async () => {
  let request;
  const db = { update: (params) => ({ promise: async () => { request = params; return {}; } }) };
  const data = createDataAccess({ dynamodb: db, tables: { words: 'words' } });
  await data.updateWord('id', { definition: 'Definition' }, { expectedDefinition: '' });
  assert.match(request.ConditionExpression, /#definition = :previousDefinition/);
  assert.equal(request.ExpressionAttributeValues[':previousDefinition'], '');
  await data.updateWord('id', { definition: 'Definition' }, { expectedDefinition: undefined });
  assert.match(request.ConditionExpression, /attribute_not_exists\(#definition\)/);
});

test('mock API warns only for opted-in recipients in the word game', async (t) => {
  const app = require('../src/mockApi');
  app.locals.profiles.push(
    { user_name: 'other-game', game_id: 'default', email: 'other@example.com', notify_word_created: true },
    { user_name: 'round-only', game_id: 'local', email: 'round@example.com', notify_round_complete: true }
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  t.after(() => {
    for (const name of ['other-game', 'round-only', 'reader']) {
      const index = app.locals.profiles.findIndex((profile) => profile.user_name === name);
      if (index !== -1) app.locals.profiles.splice(index, 1);
    }
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (data) => (await fetch(`${base}/words`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ game_id: 'local', ...data })
  })).json();
  const first = await post({ word: 'alpha', definition: 'One' });
  assert.equal(first.warning, undefined);
  app.locals.profiles.push({ user_name: 'reader', game_id: 'local', email: 'reader@example.com', notify_word_created: true });
  const second = await post({ word: 'beta', definition: 'Two' });
  assert.match(second.warning, /does not send word notifications/);
  const edit = await post({ word_id: second.word.word_id, word: 'beta', definition: 'Edited' });
  assert.equal(edit.warning, undefined);
  const placeholder = await post({ word: 'gamma', definition: '' });
  assert.equal(placeholder.warning, undefined);
  const defined = await post({ word_id: placeholder.word.word_id, word: 'gamma', definition: 'Defined' });
  assert.match(defined.warning, /does not send word notifications/);
});
