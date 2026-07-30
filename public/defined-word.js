import { addUrlsToDefinition } from './frontendUtils.js';
import {getCurrentUserNameFromToken} from './frontendUtils.js';

console.log('[FRONTEND defined-word] loaded');

const params = new URLSearchParams(window.location.search);
const gameId = params.get('game_id') || 'default';
const wordId = params.get('word_id');
const token = localStorage.getItem('lexicon-token');
const wcontent = 'wordContent';

// 1. Extracted purely for data fetching (No UI logic here)
async function fetchWord(id) {
  if (!id) return null; // Guard against empty IDs
  
  const response = await fetch(
    `${window.APP_CONFIG.apiBase}/words/${encodeURIComponent(id)}?game_id=${encodeURIComponent(gameId)}`, 
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch word: ${response.status}`);
  }

  return response.json();
}

function updateEditButton(wordInfo) {
  const editButton = document.getElementById('editWordButton');
  if (!editButton) return;
  const currentUser = getCurrentUserNameFromToken(token);
  if (currentUser == wordInfo.user_name) {
    editButton.classList.remove('hidden');
    editButton.onclick = () => {
      window.location.href = `/new-definition.html?word_id=${encodeURIComponent(wordId)}${gameId ? '&game_id=' + encodeURIComponent(gameId) : ''}`;
    };
  } else {
    editButton.classList.add('hidden');
  }
}

async function renderWord() {
  const content = document.getElementById(wcontent);
  const loadingModal = document.getElementById('loadingModal');

  try {
    // Show modal once at the very beginning
    loadingModal.classList.remove('hidden');

    const main_word_data = await fetchWord(wordId);
    const wordInfo = main_word_data?.word || {};
    const new_word_hash = {};
    if (wordInfo) {
      new_word_hash[wordInfo.new_word_1] = wordInfo.new_word_1_id;
      new_word_hash[wordInfo.new_word_2] = wordInfo.new_word_2_id;
      updateEditButton(wordInfo)
    }

    // 4. Parse definition and render
    const definition = addUrlsToDefinition(wordInfo.definition, new_word_hash, gameId);
    const capitalizedWord = wordInfo.word ? wordInfo.word.charAt(0).toUpperCase() + wordInfo.word.slice(1) : '';
    const authorUrl = `/profile.html?user_name=${encodeURIComponent(wordInfo.user_name || '')}${gameId ? '&game_id=' + encodeURIComponent(gameId) : ''}`;

    content.innerHTML = `
      <h1>${capitalizedWord}</h1>
      <p>By <a href="${authorUrl}">${wordInfo.researcher_name || 'Unknown'}</a></p>
      <p>${definition}</p>
    `;

    console.log('[FRONTEND defined-word] rendered word', wordInfo.word_id || wordId);

  } catch (err) {
    console.error('[FRONTEND defined-word] render exception', err);
    content.innerHTML = '<p class="error">Unable to load word.</p>';
  } finally {
    // Always hide the loading modal at the end, whether it succeeded or failed
    loadingModal.classList.add('hidden');
  }
}

window.addEventListener('DOMContentLoaded', renderWord);