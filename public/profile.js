
import { getCurrentUserNameFromToken } from './frontendUtils.js';
import { buildHref } from './frontendUtils.js';
import { initGlobalLoader } from './frontendUtils.js';
// This file loads and displays a user profile page.
console.log('[FRONTEND profile] profile.js loaded');


// Read the selected user and game from the page URL.
const params = new URLSearchParams(window.location.search);
const gameId = params.get('game_id') || 'default';
const profileName = params.get('user_name');
const token = localStorage.getItem('lexicon-token');

// Fetch the profile data from the API and render it on the page.
async function loadProfile() {
  try {
    console.log('[FRONTEND profile] loadProfile', profileName, gameId);
    document.getElementById('loadingModal').classList.remove('hidden');
    const response = await fetch(`${window.APP_CONFIG.apiBase}/profiles/${encodeURIComponent(profileName || '')}?game_id=${encodeURIComponent(gameId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    console.log('[FRONTEND profile] loadProfile status', response.status);
    const data = await response.json().catch((err) => {
      console.error('[FRONTEND profile] json parse error', err);
      document.getElementById('loadingModal').classList.add('hidden');
      return {};
    });
    const content = document.getElementById('profileContent');
    const graphicName = `torn${Math.floor(Math.random() * 7) + 1}.png`;
    content.style.setProperty('--card-graphic', `url('./assets/${graphicName}')`);
    if (!response.ok) {
      content.innerHTML = '<p class="error">Unable to load profile.</p>';
      document.getElementById('loadingModal').classList.add('hidden');
      return;
    }
    const profile = data.profile || {};
    content.innerHTML = `
      <h1>${profile.researcher_name}</h1>
      <p>${profile.researcher_bio || ''}</p>
      <h2>Defined Words</h2>
      <ul>${(data.words || []).map((word) => `<li><a href="/defined-word.html?word_id=${word.word_id}${gameId ? '&game_id=' + encodeURIComponent(gameId) : ''}">${word.word}</a></li>`).join('')}</ul>
    `;
    document.getElementById('loadingModal').classList.add('hidden');
    console.log('[FRONTEND profile] rendered profile', profile.user_name);
  } catch (err) {
    console.error('[FRONTEND profile] loadProfile exception', err);
  }
}
initGlobalLoader();
// Update the top-right button so it shows or hides the Edit Profile button depending on auth state.
function updateButtons() {
  const profileButton = document.getElementById('editProfileButton');
  const currentUserName = getCurrentUserNameFromToken(token);
  const isLoggedIn = Boolean(currentUserName == profileName);
  profileButton.style.display = isLoggedIn ? 'block' : 'none';
  profileButton.onclick = () => {
    if (isLoggedIn) {
      window.location.href = buildHref(`/editProfile.html?user_name=${encodeURIComponent(currentUserName)}`, gameId);
      return;
    }
    window.location.href = buildHref('/login.html', gameId);
  };
  const logOutButton = document.getElementById('logOutButton');
  logOutButton.style.display = isLoggedIn ? 'block' : 'none';
  logOutButton.onclick = () => {
    localStorage.removeItem('lexicon-token');
    window.location.href = buildHref('/index.html', gameId);
  };
}
window.addEventListener('DOMContentLoaded', loadProfile);
updateButtons();