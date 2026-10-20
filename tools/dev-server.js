'use strict';
// Runs the app on localhost: the real server code over fake sheets, the page with the mock transport.
//   GET  /            the page
//   POST /api         one request envelope in, one out (tlmiApi)
//   POST /__reset     start again from the initial invented data
//   POST /__advance   { minutes } move the fake clock forward (session tests)
// It listens on 127.0.0.1 only.
const http = require('node:http');
const path = require('node:path');
const { assemblePage } = require('./assemble');
const { createEnv } = require('./dev-env');

const SRC_CLIENT = path.join(__dirname, '..', 'src', 'client');

function createServer() {
  let env = createEnv();
  const send = (res, status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', assemblePage(SRC_CLIENT, 'mock'));
      if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, 'text/plain', 'ok');
      if (req.method === 'POST' && req.url === '/api') {
        let request;
        try { request = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, 'application/json', '{"ok":false}'); }
        return send(res, 200, 'application/json', JSON.stringify(env.handle(request)));
      }
      if (req.method === 'POST' && req.url === '/__reset') { env = createEnv(); return send(res, 200, 'application/json', '{"ok":true}'); }
      if (req.method === 'POST' && req.url === '/__advance') {
        const body = JSON.parse((await readBody(req)) || '{}');
        env.google.clock.now += Number(body.minutes || 0) * 60000;
        return send(res, 200, 'application/json', '{"ok":true}');
      }
      return send(res, 404, 'text/plain', 'not found');
    } catch (e) {
      return send(res, 500, 'text/plain', 'dev server error');
    }
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, '127.0.0.1', () => console.log('TLMI dev server on http://127.0.0.1:' + port + ' (fake data, mock transport)'));
}
