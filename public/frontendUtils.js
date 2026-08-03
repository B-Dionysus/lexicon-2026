export function getCurrentUserNameFromToken(token) {
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


// Build a full link to another page while preserving the current game.
export function buildHref(path, gameID, preserveGame = true) {
  const url = new URL(path, window.location.origin);
  if (preserveGame && gameID) {
    url.searchParams.set('game_id', gameID);
  }
  return url.pathname + url.search;
}

export function addUrlsToDefinition(str, wordMap, gameId) {
    if(!str || typeof str !== 'string' || !wordMap || typeof wordMap !== 'object') return str;
    if(!wordMap || Object.keys(wordMap).length === 0) return str;

    // 1. Create a new map where all keys are guaranteed to be lowercase
    const lowerCaseMap = {};
    for (const [key, value] of Object.entries(wordMap || {})) {
        lowerCaseMap[key.toLowerCase()] = value;
    }

    const words = Object.keys(lowerCaseMap);
    if (words.length === 0) return str; 

    // 2. Escape special characters for the regex
    const safeWords = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    
    // 3. Add 'i' to the flags ('gi' instead of 'g') to make the search case-insensitive
    const regex = new RegExp(`\\b(${safeWords.join('|')})\\b`, 'gi');

    const result = str.replace(regex, (match) => {
      // 4. Force the matched text to lowercase so it finds the correct ID in our normalized map
      const wordId = lowerCaseMap[match.toLowerCase()];
      
      // We still return {match} so the original casing is preserved on the screen!
      return `<a href="${buildHref('/defined-word.html?word_id=' + wordId, gameId)}">${match}</a>`;
    });
    
    return result;
}

export function initGlobalLoader() {
  // Guard check: don't inject it if it's already written hardcoded in the HTML
  if (document.getElementById('loadingModal')) return;

  const modal = document.createElement('div');
  modal.id = 'loadingModal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="loading-card">
      <div class="archive-indexer"></div>
    </div>
  `;

  document.body.appendChild(modal);
}

// Run it immediately when the DOM is ready
document.addEventListener('DOMContentLoaded', initGlobalLoader);