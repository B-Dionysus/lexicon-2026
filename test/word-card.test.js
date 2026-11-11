const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('word cards link truncated definitions to the full word in the current game', async (t) => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  t.after(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
  });

  global.window = {
    location: { origin: 'https://example.test', search: '?game_id=game%20one' },
    addEventListener() {}
  };
  global.document = {
    addEventListener() {},
    getElementById() { return {}; }
  };
  global.localStorage = { getItem() { return null; } };

  const publicDir = path.join(__dirname, '..', 'public');
  const utilsSource = await readFile(path.join(publicDir, 'frontendUtils.js'), 'utf8');
  const utilsUrl = `data:text/javascript;base64,${Buffer.from(utilsSource).toString('base64')}`;
  const appSource = await readFile(path.join(publicDir, 'app.js'), 'utf8');
  const appUrl = `data:text/javascript;base64,${Buffer.from(
    appSource.replace("'./frontendUtils.js'", `'${utilsUrl}'`) + '\nexport { createWordCard };'
  ).toString('base64')}`;
  const { createWordCard } = await import(appUrl);

  const word = {
    word_id: 'word-1',
    word: 'alpha',
    user_name: 'author',
    new_word_1: 'more',
    new_word_1_id: 'word-2',
    definition: 'more ' + 'x'.repeat(496)
  };
  const card = createWordCard(word);
  const wordUrl = '/defined-word.html?word_id=word-1&game_id=game+one';
  assert.ok(card.includes(`<h2><a href="${wordUrl}">Alpha</a></h2>`));
  assert.ok(card.includes('<a href="/defined-word.html?word_id=word-2&game_id=game+one">more</a>'));
  assert.ok(card.includes(`${'x'.repeat(495)}… (<a href="${wordUrl}">more</a>)`));
  assert.ok(!card.includes('x'.repeat(496)));

  const exactLimit = createWordCard({ ...word, definition: 'x'.repeat(500) });
  assert.ok(exactLimit.includes('x'.repeat(500)));
  assert.ok(!exactLimit.includes('>more</a>)'));

  const shorter = createWordCard({ ...word, definition: 'short definition' });
  assert.ok(shorter.includes('<p class="definition">short definition</p>'));
  assert.ok(!shorter.includes('>more</a>)'));

  const multiline = createWordCard({ ...word, definition: 'First line\n\nmore on the next line' });
  assert.ok(multiline.includes('<p class="definition">First line\n\n<a href="/defined-word.html?word_id=word-2&game_id=game+one">more</a> on the next line</p>'));
});

test('full word displays multiline definitions with related-word links', async (t) => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalFetch = global.fetch;
  t.after(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    global.localStorage = originalLocalStorage;
    global.fetch = originalFetch;
  });

  const content = { style: { setProperty() {} }, innerHTML: '' };
  const loadingModal = { classList: { add() {}, remove() {} } };
  global.window = {
    location: { origin: 'https://example.test', search: '?word_id=word-1&game_id=game%20one' },
    APP_CONFIG: { apiBase: '/api' },
    addEventListener() {}
  };
  global.document = {
    addEventListener() {},
    getElementById(id) {
      if (id === 'wordContent') return content;
      if (id === 'loadingModal') return loadingModal;
      return null;
    }
  };
  global.localStorage = { getItem() { return null; } };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      word: {
        word_id: 'word-1',
        word: 'alpha',
        definition: 'First line\n\nmore on the next line',
        new_word_1: 'more',
        new_word_1_id: 'word-2'
      }
    })
  });

  const publicDir = path.join(__dirname, '..', 'public');
  const utilsSource = await readFile(path.join(publicDir, 'frontendUtils.js'), 'utf8');
  const utilsUrl = `data:text/javascript;base64,${Buffer.from(utilsSource).toString('base64')}`;
  const wordSource = await readFile(path.join(publicDir, 'defined-word.js'), 'utf8');
  const wordUrl = `data:text/javascript;base64,${Buffer.from(
    wordSource.replaceAll("'./frontendUtils.js'", `'${utilsUrl}'`) + '\nexport { renderWord };'
  ).toString('base64')}`;
  const { renderWord } = await import(wordUrl);
  await renderWord();

  assert.ok(content.innerHTML.includes('<p class="definition">First line\n\n<a href="/defined-word.html?word_id=word-2&game_id=game+one">more</a> on the next line</p>'));
});

test('definition styling preserves line breaks while wrapping text', async () => {
  const styles = await readFile(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(styles, /\.definition\s*\{[^}]*white-space:\s*pre-line\s*;/);
});
