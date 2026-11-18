const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { SSMClient } = require('@aws-sdk/client-ssm');

process.env.JWT_SECRET_PARAMETER = '/test/jwt-secret';
const handler = require('../src/handler');

const request = (secret) => ({
  httpMethod: 'POST',
  path: '/cache/invalidate',
  headers: { Authorization: `Bearer ${jwt.sign({ user_name: 'writer' }, secret)}` },
  body: '{}'
});

test('JWT secret is read from SSM, fails closed on errors and is cached', async (t) => {
  t.mock.method(console, 'error', () => {});
  let failing = true;
  const send = t.mock.method(SSMClient.prototype, 'send', async () => {
    if (failing) throw Object.assign(new Error('arn:secret-detail'), { name: 'AccessDeniedException' });
    return { Parameter: { Value: 'ssm-secret' } };
  });

  const failed = await handler.handler(request('dev-secret'));
  assert.equal(failed.statusCode, 500);
  assert.doesNotMatch(failed.body, /arn:secret-detail/);

  failing = false;
  assert.equal((await handler.handler(request('dev-secret'))).statusCode, 401);
  assert.equal((await handler.handler(request('ssm-secret'))).statusCode, 200);
  assert.equal(send.mock.calls.length, 2);
  const input = send.mock.calls[1].arguments[0].input;
  assert.deepEqual({ Name: input.Name, WithDecryption: input.WithDecryption }, { Name: '/test/jwt-secret', WithDecryption: true });
});
