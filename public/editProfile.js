// This file handles login and signup on the auth pages.
import { initGlobalLoader } from './frontendUtils.js';
console.log('[FRONTEND editProfile] editProfile.js loaded');

// Read the current game id from the URL so we can keep the user in the same game.
const params = new URLSearchParams(window.location.search);
const gameId = params.get('game_id') || 'default';
const currentUserName = params.get('user_name') || null;
const token = localStorage.getItem('lexicon-token');
// Send the user back to the main page after a successful login or signup.
function redirectHome() {
  console.log('[FRONTEND editProfile] redirectHome to profile, currentUserName=', currentUserName, 'gameId=', gameId);
  window.location.href = `/profile.html?user_name=${encodeURIComponent(currentUserName)}` + (gameId ? `&game_id=${encodeURIComponent(gameId)}` : '');
}
// Show a message on the page for errors or other feedback.
function setMessage(text, isError = true) {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
}
// Read the server response and turn it into a JavaScript object if possible.
async function readResponseBody(response) {
  // Read response body safely and attempt JSON parse; return simple object on failure
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn('[FRONTEND editProfile] readResponseBody parse failed', err && err.message);
    return { error: text };
  }
}

// Attach the form submit handler for either login or signup.
async function submitProfile(formId, endpoint) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    console.log('[FRONTEND editProfile] submitProfile', endpoint, data, data.user_name);
    try {
      const response = await fetch(`${window.APP_CONFIG.apiBase}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...data, game_id: gameId })
      });
      console.log('[FRONTEND editProfile] submitProfile: post done status=', response.status);
      const result = await readResponseBody(response);
      console.log('[FRONTEND editProfile] submitProfile: post done result=', result);
      if (!response.ok) {
        console.warn('[FRONTEND editProfile] error response', result);
        setMessage(result.error || 'Request failed');
        return;
      }
      console.log('[FRONTEND editProfile] received token, storing and redirecting');
      redirectHome();
    } catch (err) {
      console.error('[FRONTEND editProfile] submitProfile exception', err);
      setMessage(err.message || 'Unable to reach the server');
    }
  });
}

async function updateProfileForm() {
  console.log('[FRONTEND editProfile] updateProfileForm', currentUserName, gameId);
  const response = await fetch(`${window.APP_CONFIG.apiBase}/profiles/${encodeURIComponent(currentUserName || '')}?game_id=${encodeURIComponent(gameId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  console.log('[FRONTEND editProfile] updateProfileForm status', response.status);
  const data = await response.json().catch((err) => {
    console.error('[FRONTEND editProfile] json parse error', err);
    return {};
  });
  if (!response.ok) return;

  console.log('[FRONTEND editProfile] updateProfileForm data', data);
  const field = document.getElementById('researcher_name');
  if (field) field.value = data.profile && data.profile.researcher_name;
  const field2 = document.getElementById('researcher_bio');
  if (field2) field2.value = data.profile && data.profile.researcher_bio;
  const field3 = document.getElementById('user_name');
  if (field3) field3.value = data.profile && data.profile.user_name;
}

initGlobalLoader();
// Start the right form handler when the page loads.
if (document.getElementById('editProfileForm')) submitProfile('editProfileForm', 'profiles/');
// Run this once the page HTML has finished loading.
window.addEventListener('DOMContentLoaded', () => {
  console.log('[FRONTEND editProfile] DOMContentLoaded', { gameId: gameId, tokenPresent: !!token });
  updateProfileForm();
});