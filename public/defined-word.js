import {addUrlsToDefinition} from './frontendUtils.js';
// This file loads and displays the details for one defined word.
console.log('[FRONTEND defined-word] loaded');

// Read the page URL so we know which word and game to show.
const params = new URLSearchParams(window.location.search);
const gameId = params.get('game_id') || 'default';
const wordId = params.get('word_id');
const token = localStorage.getItem('lexicon-token');

// Fetch the chosen word from the API and show it on the page.
async function loadWord() {
  try {
    console.log('[FRONTEND defined-word] loadWord fetching', wordId, gameId);
    document.getElementById('loadingModal').classList.remove('hidden');
    const response = await fetch(`${window.APP_CONFIG.apiBase}/words/${encodeURIComponent(wordId)}?game_id=${encodeURIComponent(gameId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    console.log('[FRONTEND defined-word] loadWord response status', response.status);
    const data = await response.json().catch((err) => {
      console.error('[FRONTEND defined-word] json parse error', err);
      document.getElementById('loadingModal').classList.add('hidden');
      return {};
    });
    const content = document.getElementById('wordContent');
    if (!response.ok) {
      content.innerHTML = '<p class="error">Unable to load word.</p>';
      document.getElementById('loadingModal').classList.add('hidden');
      return;
    }
    const word = data.word || {};
    const definition = addUrlsToDefinition(word.definition || '', new_word_hash || {}, gameId);
    // const authorName = word.researcher_name || 'Unknown';
    content.innerHTML = `
      <h1>${word.word ? word.word.charAt(0).toUpperCase() + word.word.slice(1) : ''}</h1>
      <p>By <a href="/profile.html?user_name=${encodeURIComponent(word.user_name || '')}${gameId ? '&game_id=' + encodeURIComponent(gameId) : ''}">${word.researcher_name}</a></p>
      <p>${(word.definition || '').replace(/\n/g, '<br />')}</p>
    `;
    document.getElementById('loadingModal').classList.add('hidden');
    console.log('[FRONTEND defined-word] rendered word', word.word_id || wordId);
  } catch (err) {
    console.error('[FRONTEND defined-word] loadWord exception', err);
  }
}

window.addEventListener('DOMContentLoaded', loadWord);
