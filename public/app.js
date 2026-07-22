// The app starts here. This file controls the main page behavior.
console.log('[FRONTEND app] initializing app.js');

// Store the current page state so different functions can share it.
const state = { words: [], profile: null, gameId: getGameId(), token: localStorage.getItem('lexicon-token') || null };

// Read the username stored inside the login token, if one exists.
function getCurrentUserNameFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  try {
    // 1. Fix the URL-safe characters
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    // 2. Decode the base64 string and handle UTF-8 characters safely
    const decoded = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );  
    const data = JSON.parse(decoded);
    return data.user_name || null;
  } catch (_err) {
    return null;
  }
}

// Get the current game id from the page URL, such as ?game_id=abc123.
function getGameId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('game_id') || 'default';
}

// Helper for building a URL with a query parameter.
function setQueryParam(name, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  return url.toString();
}

// Build a full link to another page while preserving the current game.
function buildHref(path, preserveGame = true) {
  const url = new URL(path, window.location.origin);
  if (preserveGame && state.gameId) {
    url.searchParams.set('game_id', state.gameId);
  }
  return url.pathname + url.search;
}

// Make the first letter uppercase for nicer display.
function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

// Create the HTML for the list of words shown on the page.
function renderWordList(words) {
  const list = document.getElementById('wordList');
  console.log('[FRONTEND app] renderWordList called, count=', words.length);
  if (!words.length) {
    // Show a friendly message when there are no words yet.
    list.innerHTML = '<div class="empty">Click the create button to create the first word!</div>';
    return;
  }
  list.innerHTML = words.map((word) => {
    const isDefined = Boolean(word.definition && word.definition.trim());
    const title = capitalize(word.word);
    if (isDefined) {
      const authorName = word.researcher_name || word.user_name || 'Unknown';
      return `
        <article class="card">
          <h2><a href="${buildHref('/defined-word.html?word_id=' + word.word_id)}">${title}</a></h2>
          <div><a href="${buildHref('/profile.html?user_name=' + encodeURIComponent(word.user_name))}">By ${authorName}</a></div>
          <p>${(word.definition || '').slice(0, 200)}${(word.definition || '').length > 200 ? '…' : ''}</p>
        </article>`;
    }
    return `
      <article class="card">
        <h2><a href="${buildHref('/new-definition.html?word_id=' + word.word_id)}">${title}</a></h2>
        <p><a href="${buildHref('/new-definition.html?word_id=' + word.word_id)}">Click here to define this word</a></p>
      </article>`;
  }).join('');
}

// Load the words for the current game from the API.
async function loadWords() {
  // Fetch words for the current game. Lots of logging to trace issues.
  console.log('[FRONTEND app] loadWords: apiBase=', window.APP_CONFIG && window.APP_CONFIG.apiBase, 'gameId=', state.gameId);
  const response = await fetch(`${window.APP_CONFIG.apiBase}/words?game_id=${encodeURIComponent(state.gameId)}`, { headers: state.token ? { Authorization: `Bearer ${state.token}` } : {} });
  console.log('[FRONTEND app] loadWords: fetch completed, status=', response.status);
  const data = await response.json().catch((err) => {
    console.error('[FRONTEND app] loadWords: json parse error', err);
    return {};
  });
  console.log('[FRONTEND app] loadWords: data values', Object.values(data || {}));
  state.words = data.words || [];
  renderWordList(state.words);
}

// Update the top-right button so it says Login or Profile depending on auth state.
function updateProfileButton() {
  const button = document.getElementById('profileButton');
  const currentUserName = getCurrentUserNameFromToken(state.token);
  const isLoggedIn = Boolean(currentUserName);
  button.textContent = isLoggedIn ? 'Profile' : 'Login';
  button.onclick = () => {
    if (isLoggedIn) {
      window.location.href = buildHref(`/profile.html?user_name=${encodeURIComponent(currentUserName)}`);
      return;
    }
    window.location.href = buildHref('/login.html');
  };
}

// Run this once the page HTML has finished loading.
window.addEventListener('DOMContentLoaded', () => {
  console.log('[FRONTEND app] DOMContentLoaded', { gameId: state.gameId, tokenPresent: !!state.token });
  updateProfileButton();
  document.getElementById('aboutButton').addEventListener('click', () => document.getElementById('aboutModal').classList.remove('hidden'));
  document.getElementById('closeAbout').addEventListener('click', () => document.getElementById('aboutModal').classList.add('hidden'));
  document.getElementById('newWordButton').addEventListener('click', () => window.location.href = buildHref('/new-definition.html'));
  loadWords().catch(() => {
    document.getElementById('wordList').innerHTML = '<div class="empty">Unable to load words yet.</div>';
  });
});
