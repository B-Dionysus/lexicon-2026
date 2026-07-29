
// Debug helper: unified logging prefix for Lambda
function debugLog(...args) {
  try {
    console.log('[LAMBDA DEBUG]', ...args);
  } catch (e) {
    // ignore logging errors
  }
}

function normalizeGameId(gameId) {
  debugLog((gameId || '').trim() || 'default');
  return (gameId || '').trim() || 'default';
}

function resolveApiBase(hostname, fallbackApiBase = '') {
  if (!hostname) return fallbackApiBase;
  const normalized = String(hostname).toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1') {
    return '/api';
  }
  return fallbackApiBase;
}

function parseAuthTokenFromHeader(header) {
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function getCurrentUserNameFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalizedPayload.length % 4)) % 4);
    const decoded = Buffer.from(normalizedPayload + padding, 'base64').toString('utf8');
    const data = JSON.parse(decoded);
    return data.user_name || null;
  } catch (_err) {
    return null;
  }
}

function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function decorateWordsWithResearcherNames(words, profilesByUserName) {
  if (!Array.isArray(words)) return [];
  return words.map((word) => {
    const profile = profilesByUserName && profilesByUserName[word.user_name];
    return {
      ...word,
      researcher_name: profile && profile.researcher_name ? profile.researcher_name : null
    };
  });
}

function extractBody(event) {
  if (!event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (_err) {
    return {};
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE,PATCH,HEAD'
  };
}

function success(body, statusCode = 200) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

function error(message, statusCode = 400) {
  return success({ error: message }, statusCode);
}

module.exports = {
  normalizeGameId,
  resolveApiBase,
  parseAuthTokenFromHeader,
  getCurrentUserNameFromToken,
  capitalize,
  decorateWordsWithResearcherNames,
  extractBody,
  success,
  error
};


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