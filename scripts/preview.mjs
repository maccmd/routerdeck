import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mounts = [
 ['/preview/', resolve(root, 'preview')],
 ['/luci-static/routerdeck/', resolve(root, 'luci-theme-routerdeck/htdocs/luci-static/routerdeck')]
];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
 try {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file;
  if (path === '/' || path === '/index.html') file = resolve(root, 'preview/index.html');
  else if (/^\/luci-static\/routerdeck\/workspace(?:-frame)?\.(?:js|css)$/.test(path)) file = resolve(root, 'luci-app-routerdeck-workspace/htdocs' + path);
  else if (path === '/luci-static/routerdeck/dashboard.js') file = resolve(root, 'luci-app-routerdeck/htdocs/luci-static/routerdeck/dashboard.js');
  else {
   const mount = mounts.find(([prefix]) => path.startsWith(prefix));
   if (mount) {
    const candidate = resolve(mount[1], path.slice(mount[0].length));
    if (candidate.startsWith(mount[1] + '/')) file = candidate;
   }
  }
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  const body = await readFile(file);
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
 } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 5173), '127.0.0.1', () => console.log(`RouterDeck preview: http://127.0.0.1:${server.address().port} (mock data only)`));
