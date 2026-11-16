// This file handles login and signup on the auth pages.
console.log('[FRONTEND auth] auth.js loaded');

// Read the current game id from the URL so we can keep the user in the same game.
const params = new URLSearchParams(window.location.search);
const gameId = params.get('game_id') || 'default';

// Send the user back to the main page after a successful login or signup.
function redirectHome() {
  console.log('[FRONTEND auth] redirectHome to index, gameId=', gameId);
  window.location.href = '/index.html' + (gameId ? `?game_id=${encodeURIComponent(gameId)}` : '');
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
    console.warn('[FRONTEND auth] readResponseBody parse failed', err && err.message);
    return { error: text };
  }
}

// Attach the form submit handler for either login or signup.
async function submitAuth(formId, endpoint) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (formId === 'signupForm') {
      data.notify_word_created = form.elements.notify_word_created.checked;
      data.notify_round_complete = form.elements.notify_round_complete.checked;
    }
    console.log('[FRONTEND auth] submitAuth', endpoint);
    try {
      const response = await fetch(`${window.APP_CONFIG.apiBase}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, game_id: gameId })
      });
      console.log('[FRONTEND auth] submitAuth: fetch done status=', response.status);
      const result = await readResponseBody(response);
      if (!response.ok) {
        console.warn('[FRONTEND auth] error response', result);
        setMessage(result.error || 'Request failed');
        return;
      }
      if (!result.token) {
        setMessage('Signup failed');
        return;
      }
      console.log('[FRONTEND auth] received token, storing and redirecting');
      localStorage.setItem('lexicon-token', result.token);
      if (result.warning) {
        form.hidden = true;
        setMessage(result.warning);
        const link = document.createElement('a');
        link.href = '/index.html' + (gameId ? `?game_id=${encodeURIComponent(gameId)}` : '');
        link.textContent = ' Continue to the game';
        document.getElementById('message').appendChild(link);
        return;
      }
      redirectHome();
    } catch (err) {
      console.error('[FRONTEND auth] submitAuth exception', err);
      setMessage(err.message || 'Unable to reach the server');
    }
  });
}
// Start the right form handler when the page loads.
if (document.getElementById('loginForm')) submitAuth('loginForm', 'login');
if (document.getElementById('signupForm')) submitAuth('signupForm', 'signup');
