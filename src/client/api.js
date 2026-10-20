// The only way the screens talk to the server. One function per action over a transport:
//   appsscript  google.script.run.tlmiApi (the deployed web app)
//   mock        POST /api (localhost, the real server code over fake sheets: tools/dev-server.js)
//   rest        added when TDMS moves to its full stack
// The token is kept in memory only: never in storage, never in the URL.
(function (root) {
  'use strict';
  const state = { transport: root.TLMI_TRANSPORT || 'appsscript', token: null, onSessionEnd: null };
  let counter = 0;

  function send(request) {
    if (state.transport === 'mock') {
      return fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
        .then((r) => {
          if (!r.ok) throw { code: 'NETWORK', message: 'The server did not answer. Try again.' };
          return r.json();
        });
    }
    if (state.transport === 'appsscript') {
      return new Promise((resolve, reject) => {
        root.google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(() => reject({ code: 'NETWORK', message: 'The server did not answer. Try again.' }))
          .tlmiApi(request);
      });
    }
    return Promise.reject({ code: 'NETWORK', message: 'Unknown transport: ' + state.transport });
  }

  // Resolves with the whole envelope, or rejects with { code, message, fields, retry_after, current }.
  function callFull(method, params, opts) {
    counter += 1;
    const request = { v: 1, rid: 'c' + counter, method: method, params: params || {} };
    if (state.token) request.token = state.token;
    if (opts && opts.reason) request.reason = opts.reason;
    return send(request).then((env) => {
      if (env && env.ok) return env;
      const err = (env && env.error) || { code: 'SERVER', message: 'Something went wrong.' };
      if ((err.code === 'SESSION_EXPIRED' || err.code === 'AUTH_REQUIRED') && method !== 'auth.signIn' && state.onSessionEnd) {
        state.token = null;
        state.onSessionEnd(err);
      }
      throw err;
    });
  }

  function call(method, params, opts) { return callFull(method, params, opts).then((env) => env.data); }

  root.Api = {
    configure: function (opts) { if (opts.transport) state.transport = opts.transport; if (opts.onSessionEnd) state.onSessionEnd = opts.onSessionEnd; },
    setToken: function (t) { state.token = t || null; },
    hasToken: function () { return !!state.token; },
    call: call,
    callFull: callFull,
  };
})(window);
