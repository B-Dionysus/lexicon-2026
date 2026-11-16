
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
    if (data.admin) renderAdmin(content, data.admin.game);
    document.getElementById('loadingModal').classList.add('hidden');
    console.log('[FRONTEND profile] rendered profile', profile.user_name);
  } catch (err) {
    console.error('[FRONTEND profile] loadProfile exception', err);
  }

  function renderAdmin(content, game) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = 'Admin';
    section.appendChild(heading);
    const details = document.createElement('p');
    section.appendChild(details);
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    section.appendChild(message);
    if (!game) {
      details.textContent = 'Game not found. Visit a valid game URL to manage its rounds.';
    } else {
      details.textContent = `${game.name} — ${game.completed ? 'Game complete' : `Round ${game.current_letter}`}`;
      if (!game.completed) {
        const button = document.createElement('button');
        button.className = 'btn';
        button.textContent = 'End Current Round';
        section.appendChild(button);
        button.addEventListener('click', async () => {
          button.disabled = true;
          message.textContent = 'Ending round…';
          try {
            const response = await fetch(`${window.APP_CONFIG.apiBase}/admin/round`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ game_id: game.game_id, current_letter: game.current_letter })
            });
            const result = await response.json();
            if (!response.ok) {
              message.textContent = result.error || 'Unable to end the round. Refresh this page before trying again.';
              return;
            }
            game = result.game;
            details.textContent = `${game.name} — ${game.completed ? 'Game complete' : `Round ${game.current_letter}`}`;
            message.textContent = result.warning || 'Round ended.';
            button.disabled = game.completed;
            if (game.completed) button.hidden = true;
          } catch (err) {
            console.error('[FRONTEND profile] end round failed', err);
            message.textContent = 'Unable to confirm whether the round ended. Refresh this page before trying again.';
          }
        });
      }
    }
    content.appendChild(section);
  }
}
initGlobalLoader();
// Update the top-right button so it shows or hides the Edit Profile button depending on auth state.
function updateButtons() {
  document.getElementById('homeButton').onclick = () => {
    window.location.href = buildHref('/index.html', gameId);
  };
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