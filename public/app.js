// 1. All imports MUST go at the very top of ES Modules
import { 
  getCurrentUserNameFromToken, 
  buildHref, 
  addUrlsToDefinition,
  initGlobalLoader
} from './frontendUtils.js';

console.log('[FRONTEND app] initializing app.js');

// 2. Define helpers before using them to build state
function getGameId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('game_id') || 'default';
}

// 3. Initialize state
const state = { 
  words: [], 
  profile: null, 
  gameId: getGameId(), 
  token: localStorage.getItem('lexicon-token') || null 
};

// 4. Utility functions
function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

// 5. Extracted the card HTML generation into its own function for readability
function createWordCard(word) {
  const title = capitalize(word.word);
  const isDefined = Boolean(word.definition && word.definition.trim());

  if (!isDefined) {
    const defineUrl = buildHref('/new-definition.html?word_id=' + word.word_id, state.gameId);
    return `
      <article class="card">
        <h2><a href="${defineUrl}">${title}</a></h2>
        <p><a href="${defineUrl}">Click here to define this word</a></p>
      </article>`;
  }

  // Word is defined
  const authorName = word.researcher_name || word.user_name || 'Unknown';
  const authorUrl = buildHref('/profile.html?user_name=' + encodeURIComponent(word.user_name));
  const wordUrl = buildHref('/defined-word.html?word_id=' + word.word_id, state.gameId);
  
  // Notice this perfectly matches the hash format { "word": "id" } we optimized earlier
  const relatedWordsMap = { 
    [word.new_word_1]: word.new_word_1_id, 
    [word.new_word_2]: word.new_word_2_id 
  };
  
  const truncatedDef = word.definition.length > 200 ? word.definition.slice(0, 200) + '…' : word.definition;
  const definition = addUrlsToDefinition(truncatedDef, relatedWordsMap, state.gameId) || '';

  return `
    <article class="card">
      <h2><a href="${wordUrl}">${title}</a></h2>
      <div><a href="${authorUrl}">By ${authorName}</a></div>
      <p>${definition}</p>
    </article>`;
}

function renderWordList(words) {
  const list = document.getElementById('wordList');
  console.log('[FRONTEND app] renderWordList called, count=', words.length);
  
  if (!words.length) {
    list.innerHTML = '<div class="empty">Click the create button to create the first word!</div>';
    return;
  }
  
  // Now our map function is just one clean line
  list.innerHTML = words.map(createWordCard).join('');
}

// 6. Upgraded to try/catch/finally for safer network requests
async function loadWords() {
  const loadingModal = document.getElementById('loadingModal');
  const list = document.getElementById('wordList');
  console.log('[FRONTEND app] loadWords: apiBase=', window.APP_CONFIG?.apiBase, 'gameId=', state.gameId);
  
  try {
    loadingModal.classList.remove('hidden');
    
    const response = await fetch(`${window.APP_CONFIG.apiBase}/words?game_id=${encodeURIComponent(state.gameId)}`, { 
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {} 
    });
    
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    state.words = data.words || [];
    renderWordList(state.words);
    
  } catch (err) {
    console.error('[FRONTEND app] loadWords: fetch error', err);
    list.innerHTML = '<div class="empty">Unable to load words yet.</div>';
  } finally {
    // Guarantees the loading spinner goes away even if the API crashes
    loadingModal.classList.add('hidden');
  }
}
async function loadSubtitle() {
  const subtitleElement = document.getElementById('subtitle');
  subtitleElement.textContent = 'Loading...';
  
  try {
    // 1. Put the fetch inside the try block to catch pure network/DNS failures
    const response = await fetch(`${window.APP_CONFIG.apiBase}/game?game_id=${encodeURIComponent(state.gameId)}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    // 2. Consume the JSON stream exactly once
    const data = await response.json();
    
    // 3. Use the database subtitle, or fallback to the default if it's empty
    subtitleElement.textContent = data.game.subtitle || "A collaborative dictionary game.";
    
  } catch (err) {
    // 4. If the API is down or permissions fail, cleanly drop in the fallback text
    console.error('[FRONTEND app] loadSubtitle: fetch error', err);
    subtitleElement.textContent = "A collaborative dictionary game.";
  }
}

async function invalidateCache(gameId = state.gameId) {
  const url = `${window.APP_CONFIG.apiBase}/cache/invalidate?game_id=${encodeURIComponent(gameId)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {}
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Unable to invalidate cache: ${response.status} ${text}`);
  }
  return response.json();
}

window.invalidateWordListCache = invalidateCache;

function updateProfileButton() {
  const button = document.getElementById('profileButton');
  const currentUserName = getCurrentUserNameFromToken(state.token);
  
  if (currentUserName) {
    button.textContent = 'Profile';
    button.onclick = () => window.location.href = buildHref(`/profile.html?user_name=${encodeURIComponent(currentUserName)}`, state.gameId);
  } else {
    button.textContent = 'Login';
    button.onclick = () => window.location.href = buildHref('/login.html', state.gameId);
  }
}

// 7. Event setup
initGlobalLoader();
window.addEventListener('DOMContentLoaded', () => {
  console.log('[FRONTEND app] DOMContentLoaded', { gameId: state.gameId, tokenPresent: !!state.token });
  
  updateProfileButton();
  loadSubtitle();
  // Modal toggles
  document.getElementById('aboutButton').addEventListener('click', () => document.getElementById('aboutModal').classList.remove('hidden'));
  document.getElementById('closeAbout').addEventListener('click', () => document.getElementById('aboutModal').classList.add('hidden'));
  
  // Navigation
  document.getElementById('newWordButton').addEventListener('click', () => window.location.href = buildHref('/new-definition.html', state.gameId));
  
  loadWords();
});

document.addEventListener('DOMContentLoaded', () => {
  const themeSelector = document.getElementById('themeSelector');
  
  if (themeSelector) {
    themeSelector.addEventListener('change', (event) => {
      const selectedTheme = event.target.value;
      
      // Update the dataset on the body tag
      document.body.setAttribute('data-theme', selectedTheme);
      
      // Optional: Store the preference locally so it survives refreshes
      localStorage.setItem('lexicon_button_theme', selectedTheme);
    });

    // Optional Auto-Load Check on Startup:
    const savedTheme = localStorage.getItem('lexicon_button_theme');
    if (savedTheme) {
      document.body.setAttribute('data-theme', savedTheme);
      themeSelector.value = savedTheme;
    }
  }
});