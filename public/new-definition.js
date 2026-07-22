// This file handles creating or editing a word definition.
console.log('[FRONTEND new-definition] loaded');

// Read the current game and word from the URL.
const params = new URLSearchParams(window.location.search);
const gameId = params.get('game_id') || 'default';
const wordId = params.get('word_id');
const token = localStorage.getItem('lexicon-token');

// Show a message above the form when something goes wrong.
function setMessage(text, isError = true) {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// If the page is for an existing word, fill the form with its current value.
async function loadExistingWord() {
  if (!wordId) return;
  try {
    console.log('[FRONTEND new-definition] loadExistingWord', wordId);
    const response = await fetch(`${window.APP_CONFIG.apiBase}/words/${encodeURIComponent(wordId)}?game_id=${encodeURIComponent(gameId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    console.log('[FRONTEND new-definition] loadExistingWord status', response.status);
    const data = await response.json().catch((err) => {
      console.error('[FRONTEND new-definition] json parse error', err);
      return {};
    });
    if (!response.ok) return;
    const field = document.getElementById('word');
    if (field) field.value = data.word && data.word.word || '';
  } catch (err) {
    console.error('[FRONTEND new-definition] loadExistingWord exception', err);
  }
}

// Wait for the page to finish loading, then attach the form behavior.
window.addEventListener('DOMContentLoaded', () => {
  const wordField = document.getElementById('word');
  if (wordField) {
    wordField.readOnly = Boolean(wordId);
    console.log('[FRONTEND new-definition] word field readonly=', wordField.readOnly, 'wordId=', wordId);
  }
  loadExistingWord();
  const form = document.getElementById('definitionForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!token) {
      window.location.href = '/login.html' + (gameId ? `?game_id=${encodeURIComponent(gameId)}` : '');
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      console.log('[FRONTEND new-definition] submitting', data);
      const response = await fetch(`${window.APP_CONFIG.apiBase}/words`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...data, game_id: gameId, word_id: wordId })
      });
      console.log('[FRONTEND new-definition] submit status', response.status);
      const result = await response.json().catch((err) => {
        console.error('[FRONTEND new-definition] submit json parse error', err);
        return {};
      });
      if (!response.ok) {
        setMessage(result.error || 'Unable to save');
        return;
      }
      console.log('[FRONTEND new-definition] submit successful, redirecting to index');
      window.location.href = '/index.html' + (gameId ? `?game_id=${encodeURIComponent(gameId)}` : '');
    } catch (err) {
      console.error('[FRONTEND new-definition] submit exception', err);
      setMessage(err.message || 'Unable to save');
    }
  });
});
