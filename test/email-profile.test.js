const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const handler = require('../src/handler');
const { normalizeEmail, welcomeEmail } = require('../src/lib/email');

const access = handler.__test__.dataAccess;
const auth = (name) => ({ Authorization: 'Bearer ' + jwt.sign({ user_name: name }, process.env.JWT_SECRET || 'dev-secret') });

test('email addresses are optional and reject invalid input', () => {
  assert.equal(normalizeEmail(undefined), undefined);
  assert.equal(normalizeEmail('  '), '');
  assert.equal(normalizeEmail(' player@example.com '), 'player@example.com');
  for (const invalid of [null, 42, 'not-an-email', 'one@example.com,two@example.com', 'a@-example.com']) {
    assert.equal(normalizeEmail(invalid), null);
  }
});

test('welcome email uses the configured SES sender and recipient', async (t) => {
  const previous = process.env.EMAIL_FROM;
  process.env.EMAIL_FROM = 'sender@example.com';
  t.after(() => {
    if (previous === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previous;
  });
  const send = t.mock.method(SESClient.prototype, 'send', async () => ({}));
  await welcomeEmail.send('player@example.com', { notify_word_created: true, notify_round_complete: false });
  const command = send.mock.calls[0].arguments[0];
  assert.ok(command instanceof SendEmailCommand);
  assert.equal(command.input.Source, 'sender@example.com');
  assert.deepEqual(command.input.Destination.ToAddresses, ['player@example.com']);
  assert.match(command.input.Message.Subject.Data, /Welcome/);
  assert.match(command.input.Message.Body.Text.Data, /player creates a word: On/);
  assert.match(command.input.Message.Body.Text.Data, /all players complete their word: Off/);
});

test('signup saves an optional email and sends a welcome email', async (t) => {
  t.mock.method(access, 'getProfile', async () => null);
  let saved;
  t.mock.method(handler.__test__.dynamodb, 'put', (params) => ({ promise: async () => { saved = params.Item; } }));
  const send = t.mock.method(handler.__test__.welcomeEmail, 'send', async () => {});
  const body = { user_name: 'researcher', password: 'password123', repeat_password: 'password123', researcher_name: 'Ada', researcher_bio: 'Bio', email: ' player@example.com ', notify_word_created: true, notify_round_complete: false };

  const response = await handler.handleSignup({ body: JSON.stringify(body) });
  assert.equal(response.statusCode, 200);
  assert.equal(saved.email, 'player@example.com');
  assert.equal(send.mock.calls.length, 1);
  assert.equal(send.mock.calls[0].arguments[0], saved.email);
  assert.deepEqual(send.mock.calls[0].arguments[1], { notify_word_created: true, notify_round_complete: false });

  const invalid = await handler.handleSignup({ body: JSON.stringify({ ...body, email: 'invalid' }) });
  assert.equal(invalid.statusCode, 400);
  const invalidPreference = await handler.handleSignup({ body: JSON.stringify({ ...body, notify_word_created: 'false' }) });
  assert.equal(invalidPreference.statusCode, 400);
  assert.equal(send.mock.calls.length, 1);
});

test('preference changes send one updated welcome email only when an address is present', async (t) => {
  let profile = { user_name: 'researcher', researcher_name: 'Ada', researcher_bio: 'Bio', email: 'player@example.com' };
  t.mock.method(access, 'getProfile', async () => profile);
  t.mock.method(access, 'updateProfile', async (_name, updates) => { profile = { ...profile, ...updates }; });
  const send = t.mock.method(handler.__test__.welcomeEmail, 'send', async () => {});
  const update = (values) => handler.handleUpdateProfile({ headers: auth('researcher'), body: JSON.stringify({ user_name: 'researcher', ...values }) });

  await update({ notify_word_created: false, notify_round_complete: false });
  assert.equal(send.mock.calls.length, 0);
  await update({ notify_word_created: true, notify_round_complete: true });
  assert.equal(send.mock.calls.length, 1);
  assert.deepEqual(send.mock.calls[0].arguments, ['player@example.com', { notify_word_created: true, notify_round_complete: true }]);
  await update({ notify_word_created: false });
  assert.equal(send.mock.calls.length, 2);
  assert.deepEqual(send.mock.calls[1].arguments[1], { notify_word_created: false, notify_round_complete: true });
  await update({ researcher_name: 'Changed' });
  assert.equal(send.mock.calls.length, 2);
  await update({ email: '', notify_round_complete: false });
  assert.equal(send.mock.calls.length, 2);
  await update({ email: 'new@example.com', notify_word_created: true });
  assert.equal(send.mock.calls.length, 3);
  assert.deepEqual(send.mock.calls[2].arguments, ['new@example.com', { notify_word_created: true, notify_round_complete: false }]);
  const invalid = await update({ notify_round_complete: 'false' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(send.mock.calls.length, 3);
});

test('profile updates send only for a newly added or changed address', async (t) => {
  let profile = { user_name: 'researcher', researcher_name: 'Ada', researcher_bio: 'Bio', email: 'old@example.com' };
  t.mock.method(access, 'getProfile', async () => profile);
  t.mock.method(access, 'updateProfile', async (_name, updates) => { profile = { ...profile, ...updates }; });
  const send = t.mock.method(handler.__test__.welcomeEmail, 'send', async () => {});
  const update = (email) => handler.handleUpdateProfile({ headers: auth('researcher'), body: JSON.stringify({ user_name: 'researcher', ...(email !== undefined && { email }) }) });

  assert.equal((await update(' new@example.com ')).statusCode, 200);
  assert.equal(profile.email, 'new@example.com');
  assert.equal(send.mock.calls.length, 1);
  assert.equal(send.mock.calls[0].arguments[0], 'new@example.com');
  await update('new@example.com');
  await update(undefined);
  assert.equal(profile.email, 'new@example.com');
  await update('');
  assert.equal(profile.email, '');
  assert.equal(send.mock.calls.length, 1);
  await update('again@example.com');
  assert.equal(send.mock.calls.length, 2);
  assert.equal((await update('bad')).statusCode, 400);
  assert.equal(profile.email, 'again@example.com');
});

test('email failure saves the profile and returns a warning', async (t) => {
  t.mock.method(access, 'getProfile', async () => ({ user_name: 'researcher', researcher_name: 'Ada', researcher_bio: 'Bio' }));
  let saved;
  t.mock.method(access, 'updateProfile', async (_name, updates) => { saved = updates; });
  t.mock.method(handler.__test__.welcomeEmail, 'send', async () => { throw new Error('SES unavailable'); });
  const response = await handler.handleUpdateProfile({
    headers: auth('researcher'),
    body: JSON.stringify({ user_name: 'researcher', email: 'player@example.com' })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(saved.email, 'player@example.com');
  assert.match(JSON.parse(response.body).warning, /welcome email could not be sent/);
});

test('only the authenticated profile owner can read the email address', async (t) => {
  t.mock.method(access, 'getProfile', async () => ({ user_name: 'researcher', researcher_name: 'Ada', email: 'player@example.com' }));
  t.mock.method(access, 'listWordsByUserNameAndGame', async () => []);
  const event = { pathParameters: { user_name: 'researcher' } };
  for (const headers of [{}, auth('another-user'), { Authorization: 'Bearer invalid' }]) {
    const response = await handler.handleGetProfile({ ...event, headers });
    assert.equal(Object.hasOwn(JSON.parse(response.body).profile, 'email'), false);
    assert.equal(Object.hasOwn(JSON.parse(response.body).profile, 'notify_word_created'), false);
    assert.equal(response.headers['Cache-Control'], 'no-store');
  }
  const own = await handler.handleGetProfile({ ...event, headers: auth('researcher') });
  assert.equal(JSON.parse(own.body).profile.email, 'player@example.com');
  assert.equal(JSON.parse(own.body).profile.notify_word_created, false);
  assert.equal(JSON.parse(own.body).profile.notify_round_complete, false);
});

test('preference changes preserve the saved profile and warn if sending fails', async (t) => {
  t.mock.method(access, 'getProfile', async () => ({ user_name: 'researcher', email: 'player@example.com' }));
  let saved;
  t.mock.method(access, 'updateProfile', async (_name, updates) => { saved = updates; });
  t.mock.method(handler.__test__.welcomeEmail, 'send', async () => { throw new Error('SES unavailable'); });
  const response = await handler.handleUpdateProfile({
    headers: auth('researcher'),
    body: JSON.stringify({ user_name: 'researcher', notify_round_complete: true })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(saved.notify_round_complete, true);
  assert.match(JSON.parse(response.body).warning, /welcome email could not be sent/);
});

test('mock API supports private email signup and profile edits without sending mail', async (t) => {
  const app = require('../src/mockApi');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const signup = await fetch(`${base}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_name: 'local-user', password: 'password123', repeat_password: 'password123', researcher_name: 'Ada', researcher_bio: 'Bio', email: 'old@example.com' })
  });
  const signedUp = await signup.json();
  assert.equal(signup.status, 200);
  assert.match(signedUp.warning, /does not send/);
  const headers = { Authorization: `Bearer ${signedUp.token}` };
  const privateProfile = await fetch(`${base}/profiles/local-user`, { headers });
  assert.equal((await privateProfile.json()).profile.email, 'old@example.com');
  const publicProfile = await fetch(`${base}/profiles/local-user`);
  assert.equal(Object.hasOwn((await publicProfile.json()).profile, 'email'), false);
  const updated = await fetch(`${base}/profiles/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_name: 'local-user', email: 'new@example.com', notify_word_created: true })
  });
  const result = await updated.json();
  assert.equal(result.profile.email, 'new@example.com');
  assert.equal(result.profile.notify_word_created, true);
  assert.match(result.warning, /does not send/);
  const preferenceOnly = await fetch(`${base}/profiles/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_name: 'local-user', notify_word_created: false })
  });
  const changedPreferences = await preferenceOnly.json();
  assert.equal(changedPreferences.profile.notify_word_created, false);
  assert.match(changedPreferences.warning, /does not send/);
});
