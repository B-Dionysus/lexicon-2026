// This file sets the API address used by the frontend.
// Local development uses the mock API, while production uses the deployed API.
const defaultApiBase = 'https://sbsqs0vnj2.execute-api.us-east-1.amazonaws.com/Prod';
const hostname = (window.location.hostname || '').toLowerCase();
const apiBase = hostname === 'localhost' || hostname === '127.0.0.1' ? '/api' : defaultApiBase;

window.APP_CONFIG = {
  apiBase
};
