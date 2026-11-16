const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { SESClient } = require('@aws-sdk/client-ses');
const handler = require('../src/handler');
const { createDataAccess } = require('../src/lib/dataAccess');
const { roundEmail } = require('../src/lib/email');

const access = handler.__test__.dataAccess;
const auth = (name) => ({ Authorization: `Bearer ${jwt.sign({ user_name: name }, process.env.JWT_SECRET || 'dev-secret')}` });
const event = (name, body) => ({ headers: name ? auth(name) : {}, body: JSON.stringify(body) });

test('signup rejects the example and nonexistent games before saving', async (t) => {
  const getGame = t.mock.method(access, 'getGame', async () => null);
  const put = t.mock.method(handler.__test__.dynamodb, 'put', () => { throw new Error('unexpected write'); });
  for (const game_id of [undefined, 'default', 'missing']) {
    const response = await handler.handleSignup(event(null, { game_id }));
    assert.equal(response.statusCode, 400);
    assert.match(JSON.parse(response.body).error, /game URL again/);
  }
  assert.equal(getGame.mock.calls.length, 1);
  assert.equal(put.mock.calls.length, 0);
});

test('admin section is returned only to an admin viewing their own profile', async (t) => {
  t.mock.method(access, 'getProfile', async () => ({ user_name: 'admin', admin: true }));
  t.mock.method(access, 'listWordsByUserNameAndGame', async () => []);
  const getGame = t.mock.method(access, 'getGame', async () => ({ game_id: 'game', name: 'My game' }));
  const base = { pathParameters: { user_name: 'admin' }, queryStringParameters: { game_id: 'game' } };
  for (const headers of [{}, auth('other')]) {
    const result = await handler.handleGetProfile({ ...base, headers });
    assert.equal(Object.hasOwn(JSON.parse(result.body), 'admin'), false);
  }
  assert.equal(getGame.mock.calls.length, 0);
  const result = await handler.handleGetProfile({ ...base, headers: auth('admin') });
  assert.deepEqual(JSON.parse(result.body).admin.game, { game_id: 'game', name: 'My game', current_letter: 'A', completed: false });
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('round advancement requires stored admin status and handles stale or concurrent requests', async (t) => {
  let letter = 'A';
  t.mock.method(access, 'getProfile', async (name) => ({ user_name: name, admin: name === 'admin' }));
  t.mock.method(access, 'getGame', async () => ({ game_id: 'game', name: 'Game', current_letter: letter }));
  t.mock.method(access, 'listRoundRecipients', async () => []);
  t.mock.method(access, 'advanceRound', async (_id, expected) => {
    if (letter !== expected) {
      const error = new Error('stale');
      error.name = 'ConditionalCheckFailedException';
      throw error;
    }
    letter = 'B';
    return { current_letter: letter, completed: false };
  });
  assert.equal((await handler.handleEndRound(event(null, {}))).statusCode, 401);
  assert.equal((await handler.handleEndRound(event('user', { game_id: 'game', current_letter: 'A', admin: true }))).statusCode, 403);
  const requests = await Promise.all([
    handler.handleEndRound(event('admin', { game_id: 'game', current_letter: 'A' })),
    handler.handleEndRound(event('admin', { game_id: 'game', current_letter: 'A' }))
  ]);
  assert.deepEqual(requests.map((response) => response.statusCode).sort(), [200, 409]);
  assert.equal(letter, 'B');
});

test('round sends individual notifications, reports failures and finishes after Z', async (t) => {
  t.mock.method(access, 'getProfile', async () => ({ admin: true }));
  t.mock.method(access, 'getGame', async () => ({ game_id: 'game', name: 'Game', current_letter: 'Z' }));
  t.mock.method(access, 'listRoundRecipients', async (gameId) => {
    assert.equal(gameId, 'game');
    return [{ user_name: 'one', email: 'one@example.com' }, { user_name: 'two', email: 'two@example.com' }];
  });
  t.mock.method(access, 'advanceRound', async () => ({ current_letter: 'Z', completed: true }));
  const send = t.mock.method(roundEmail, 'send', async (email) => {
    if (email === 'two@example.com') throw new Error('SES unavailable');
  });
  const response = await handler.handleEndRound(event('admin', { game_id: 'game', current_letter: 'Z' }));
  const result = JSON.parse(response.body);
  assert.equal(result.game.completed, true);
  assert.match(result.warning, /two/);
  assert.deepEqual(send.mock.calls[0].arguments, ['one@example.com', 'Game', 'Z', null, 'game']);
  assert.equal(send.mock.calls.length, 2);
});

test('recipient scan paginates and filters by game and opt-in', async () => {
  const requests = [];
  const db = { scan: (params) => ({ promise: async () => {
    requests.push(params);
    return requests.length === 1
      ? { Items: [{ user_name: 'a', email: 'a@example.com' }], LastEvaluatedKey: { user_name: 'a' } }
      : { Items: [{ user_name: 'b', email: '' }, { user_name: 'c', email: 'c@example.com' }] };
  } }) };
  const data = createDataAccess({ dynamodb: db, tables: { profiles: 'profiles' } });
  const result = await data.listRoundRecipients('game');
  assert.deepEqual(result.map((profile) => profile.user_name), ['a', 'c']);
  assert.equal(requests[0].ExpressionAttributeValues[':gameId'], 'game');
  assert.equal(requests[0].ExpressionAttributeValues[':enabled'], true);
  assert.deepEqual(requests[1].ExclusiveStartKey, { user_name: 'a' });
});

test('round update uses a conditional write for A and final Z', async () => {
  const requests = [];
  const db = { update: (params) => ({ promise: async () => { requests.push(params); } }) };
  const data = createDataAccess({ dynamodb: db, tables: { games: 'games' } });
  assert.deepEqual(await data.advanceRound('game', 'A'), { current_letter: 'B', completed: false });
  assert.match(requests[0].ConditionExpression, /attribute_not_exists\(current_letter\)/);
  assert.deepEqual(await data.advanceRound('game', 'Z'), { current_letter: 'Z', completed: true });
  assert.equal(requests[1].ExpressionAttributeValues[':letter'], 'Z');
  assert.match(requests[1].ConditionExpression, /completed/);
});

test('round email links to the new letter; final round says game complete', async (t) => {
  const previous = process.env.EMAIL_FROM;
  const previousSite = process.env.SITE_URL;
  process.env.EMAIL_FROM = 'sender@example.com';
  process.env.SITE_URL = 'https://example.test';
  t.after(() => {
    if (previous === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = previous;
    if (previousSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousSite;
  });
  const send = t.mock.method(SESClient.prototype, 'send', async () => ({}));
  await roundEmail.send('player@example.com', 'Game', 'A', 'B', 'game & one');
  const email = send.mock.calls[0].arguments[0].input;
  assert.deepEqual(email.Destination.ToAddresses, ['player@example.com']);
  assert.equal(email.Message.Subject.Data, '[Lexicon] Time for a new letter');
  assert.equal(email.Message.Body.Html.Data, 'Good news! We are moving on to the B words! <a href="https://example.test/index.html?game_id=game+%26+one">Click here</a> to add a new B word! Please remember to defined previously-existing but undefined B words before creating a brand new entry.');
  assert.match(email.Message.Body.Text.Data, /game_id=game\+%26\+one/);
  await roundEmail.send('player@example.com', 'Game', 'Z', null);
  assert.match(send.mock.calls[1].arguments[0].input.Message.Body.Text.Data, /Game is complete/);
});

test('mock API keeps admin access private and rejects stale round requests', async (t) => {
  const app = require('../src/mockApi');
  app.locals.profiles.push({ user_name: 'admin-round-test', admin: true, game_id: 'local', email: 'admin@example.com', notify_round_complete: true });
  t.after(() => {
    const index = app.locals.profiles.findIndex((profile) => profile.user_name === 'admin-round-test');
    app.locals.profiles.splice(index, 1);
    const game = app.locals.games.find((entry) => entry.game_id === 'local');
    delete game.current_letter;
    delete game.completed;
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const profileUrl = `${base}/profiles/admin-round-test?game_id=local`;
  const headers = { ...auth('admin-round-test'), 'Content-Type': 'application/json' };
  assert.equal(Object.hasOwn(await (await fetch(profileUrl)).json(), 'admin'), false);
  assert.equal((await (await fetch(profileUrl, { headers })).json()).admin.game.current_letter, 'A');
  const request = () => fetch(`${base}/admin/round`, { method: 'POST', headers, body: JSON.stringify({ game_id: 'local', current_letter: 'A' }) });
  const first = await request();
  const result = await first.json();
  assert.equal(first.status, 200);
  assert.equal(result.game.current_letter, 'B');
  assert.match(result.warning, /does not send/);
  assert.equal((await request()).status, 409);
});
