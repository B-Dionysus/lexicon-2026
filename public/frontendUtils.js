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
    // 1. We can now grab the words directly from the object keys
    const words = Object.keys(wordMap || {});
    const ids = Object.values(wordMap || {});
    // Quick guard in case the object is empty or null
    if (words.length === 0) return str; 

    // 2. Escape special characters and build the regex
    const safeWords = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${safeWords.join('|')})\\b`, 'g');

    // 3. Run the replacement
    const result = str.replace(regex, (match) => {
      // Look up the ID directly from the hash object
      const wordId = wordMap[match];
      
      return `<a href="${buildHref('/defined-word.html?word_id=' + wordId, gameId)}">${match}</a>`;
    });
    
    return result;
}