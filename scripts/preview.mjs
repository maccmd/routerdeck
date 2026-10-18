import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createMockUbus, MOCK_LOGIN } from './mock-ubus.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const consoleDir = resolve(root, 'routerdeck-console/htdocs/routerdeck');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const ubus = createMockUbus({ version: pkg.version });

// `--watch-console` rebuilds the console bundle on source changes.
if (process.argv.includes('--watch-console')) {
 const esbuild = await import('esbuild');
 const { buildOptions, writeStatic } = await import('./build-console.mjs');
 const context = await esbuild.context({ ...buildOptions, plugins: [{ name: 'routerdeck-static', setup(build) { build.onEnd(result => { if (!result.errors.length) writeStatic(); }); } }] });
 await context.watch();
}

const server = http.createServer(async (req, res) => {
 try {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/ubus') {
   if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
   return ubus.handler(req, res);
  }
  // cgi-io's backup download: a POSTed session id, a tar.gz back.
  if (path === '/cgi-bin/cgi-backup' && req.method === 'POST') {
   let body = '';
   for await (const chunk of req) body += chunk;
   const sid = new URLSearchParams(body).get('sessionid');
   if (!ubus.sessions.has(sid)) { res.writeHead(403); return res.end('Access denied'); }
   res.writeHead(200, { 'Content-Type': 'application/x-targz', 'Content-Disposition': 'attachment; filename="backup.tar.gz"' });
   return res.end(gzipSync('etc/config/system: simulated backup of the preview router\n'));
  }
  if (path === '/' || path === '/routerdeck') { res.writeHead(302, { Location: '/routerdeck/' }); return res.end(); }
  let file;
  if (path === '/routerdeck/') file = resolve(consoleDir, 'index.html');
  else if (path.startsWith('/routerdeck/')) {
   const candidate = resolve(consoleDir, path.slice('/routerdeck/'.length));
   if (candidate.startsWith(consoleDir + '/')) file = candidate;
  }
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  let body = await readFile(file);
  // The simulated router announces its demo credentials on the login form.
  if (file === resolve(consoleDir, 'index.html')) body = body.toString().replace('</head>', ` <meta name="routerdeck-mock-login" content="login ${MOCK_LOGIN.username}, password ${MOCK_LOGIN.password}">\n</head>`);
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
 } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 5173), '127.0.0.1', () => console.log(`RouterDeck Console preview: http://127.0.0.1:${server.address().port}/routerdeck/ (mock data only)`));
