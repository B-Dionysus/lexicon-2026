const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

test('signup keeps the user signed in and displays email failure without resubmitting', async () => {
  const source = await readFile(path.join(__dirname, '../public/auth.js'), 'utf8');
  let submit;
  const form = { hidden: false, elements: { notify_word_created: { checked: true }, notify_round_complete: { checked: false } }, addEventListener(_type, listener) { submit = listener; } };
  const message = { textContent: '', classList: { toggle() {} }, appendChild(child) { this.link = child; } };
  const storage = {};
  const window = { location: { search: '?game_id=game', href: '' }, APP_CONFIG: { apiBase: '/api' } };
  const document = {
    getElementById(id) { return id === 'signupForm' ? form : id === 'message' ? message : null; },
    createElement() { return {}; }
  };
  let submitted;
  vm.runInNewContext(source, {
    window, document, URLSearchParams, console,
    localStorage: { setItem(key, value) { storage[key] = value; } },
    FormData: class { entries() { return Object.entries({ email: 'player@example.com' }); } },
    fetch: async (_url, options) => {
      submitted = JSON.parse(options.body);
      return { ok: true, text: async () => JSON.stringify({ token: 'token', warning: 'Email could not be sent' }) };
    }
  });
  await submit({ preventDefault() {} });
  assert.equal(storage['lexicon-token'], 'token');
  assert.equal(form.hidden, true);
  assert.equal(message.textContent, 'Email could not be sent');
  assert.equal(message.link.href, '/index.html?game_id=game');
  assert.equal(window.location.href, '');
  assert.equal(submitted.notify_word_created, true);
  assert.equal(submitted.notify_round_complete, false);
});

test('profile editor loads and submits both notification preferences', async (t) => {
  const originals = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, FormData: global.FormData };
  t.after(() => Object.assign(global, originals));
  const fields = {
    researcher_name: {}, researcher_bio: {}, user_name: {}, email: {},
    notify_word_created: { checked: false }, notify_round_complete: { checked: false }
  };
  let submit;
  const button = { disabled: true };
  const form = {
    elements: fields,
    querySelector() { return button; },
    addEventListener(_type, listener) { submit = listener; }
  };
  global.window = { location: { search: '?user_name=researcher', href: '' }, APP_CONFIG: { apiBase: '/api' }, addEventListener() {} };
  global.document = { getElementById(id) { return id === 'editProfileForm' ? form : fields[id]; } };
  global.localStorage = { getItem() { return 'token'; } };
  global.FormData = class { entries() { return Object.entries({ user_name: 'researcher', email: 'player@example.com' }); } };
  let submitted;
  global.fetch = async (_url, options) => {
    if (!options.method) return { ok: true, json: async () => ({ profile: { user_name: 'researcher', email: 'player@example.com', notify_word_created: true, notify_round_complete: false } }) };
    submitted = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({}) };
  };
  let source = await readFile(path.join(__dirname, '../public/editProfile.js'), 'utf8');
  source = source.replace("import { initGlobalLoader } from './frontendUtils.js';", 'const initGlobalLoader = () => {};');
  const url = `data:text/javascript;base64,${Buffer.from(source + '\nexport { updateProfileForm };').toString('base64')}`;
  const { updateProfileForm } = await import(url);
  await updateProfileForm();
  assert.equal(button.disabled, false);
  assert.equal(fields.notify_word_created.checked, true);
  assert.equal(fields.notify_round_complete.checked, false);
  fields.notify_word_created.checked = false;
  fields.notify_round_complete.checked = true;
  await submit({ preventDefault() {} });
  assert.equal(submitted.notify_word_created, false);
  assert.equal(submitted.notify_round_complete, true);
});

test('admin profile control advances the displayed game and reports email failures', async () => {
  let source = await readFile(path.join(__dirname, '../public/profile.js'), 'utf8');
  source = source.replace(/^import .*;\n/gm, '');
  const createElement = (tag) => ({
    tag, children: [], appendChild(child) { this.children.push(child); },
    setAttribute() {}, addEventListener(_type, listener) { this.click = listener; }
  });
  const content = createElement('div');
  content.style = { setProperty() {} };
  const nodes = {
    homeButton: {}, editProfileButton: { style: {} }, logOutButton: { style: {} },
    profileContent: content, loadingModal: { classList: { add() {}, remove() {} } }
  };
  const context = {
    window: { location: { search: '?game_id=game&user_name=admin' }, APP_CONFIG: { apiBase: '/api' }, addEventListener() {} },
    document: { createElement, getElementById: (id) => nodes[id] },
    localStorage: { getItem: () => 'token' },
    getCurrentUserNameFromToken: () => 'admin', buildHref: (path) => path,
    initGlobalLoader() {}, URLSearchParams, console
  };
  let request;
  context.fetch = async (url, options) => {
    if (!options.method) return { ok: true, json: async () => ({ profile: { user_name: 'admin' }, words: [], admin: { game: { game_id: 'game', name: 'Example', current_letter: 'A', completed: false } } }) };
    request = { url, ...options };
    return { ok: true, json: async () => ({ game: { game_id: 'game', name: 'Example', current_letter: 'B', completed: false }, warning: 'Email failed' }) };
  };
  vm.runInNewContext(`${source}\nthis.loadProfile = loadProfile;`, context);
  await context.loadProfile();
  const section = content.children[0];
  assert.equal(section.children[1].textContent, 'Example — Round A');
  const button = section.children[3];
  await button.click();
  assert.equal(request.url, '/api/admin/round');
  assert.equal(request.headers.Authorization, 'Bearer token');
  assert.deepEqual(JSON.parse(request.body), { game_id: 'game', current_letter: 'A' });
  assert.equal(section.children[1].textContent, 'Example — Round B');
  assert.equal(section.children[2].textContent, 'Email failed');
  assert.equal(button.disabled, false);
});
