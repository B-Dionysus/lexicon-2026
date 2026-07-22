// This file loads and displays a user profile page.
console.log('[FRONTEND profile] profile.js loaded');

// Read the selected user and game from the page URL.
const params = new URLSearchParams(window.location.search);
const gameId = params.get('game_id') || 'default';
const userName = params.get('user_name');
const token = localStorage.getItem('lexicon-token');

// Fetch the profile data from the API and render it on the page.
async function loadProfile() {
  try {
    console.log('[FRONTEND profile] loadProfile', userName, gameId);
    const response = await fetch(`${window.APP_CONFIG.apiBase}/profiles/${encodeURIComponent(userName || '')}?game_id=${encodeURIComponent(gameId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    console.log('[FRONTEND profile] loadProfile status', response.status);
    const data = await response.json().catch((err) => {
      console.error('[FRONTEND profile] json parse error', err);
      return {};
    });
    const content = document.getElementById('profileContent');
    if (!response.ok) {
      content.innerHTML = '<p class="error">Unable to load profile.</p>';
      return;
    }
    const profile = data.profile || {};
    content.innerHTML = `
      <h1>${profile.researcher_name}</h1>
      <p>${profile.researcher_bio || ''}</p>
      <h2>Defined Words</h2>
      <ul>${(data.words || []).map((word) => `<li><a href="/defined-word.html?word_id=${word.word_id}${gameId ? '&game_id=' + encodeURIComponent(gameId) : ''}">${word.word}</a></li>`).join('')}</ul>
    `;
    console.log('[FRONTEND profile] rendered profile', profile.user_name);
  } catch (err) {
    console.error('[FRONTEND profile] loadProfile exception', err);
  }
}

window.addEventListener('DOMContentLoaded', loadProfile);
