import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wgsl': 'text/plain', '.md': 'text/plain' };
export async function startServer(port = 8765) {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const path = resolve(root, '.' + (pathname.endsWith('/') ? pathname+'index.html' : pathname));
      if (!path.startsWith(root.endsWith(sep) ? root : root+sep) || pathname.split('/').some(p => p.startsWith('.'))) { res.writeHead(403); res.end(); return; }
      const data = await readFile(path);
      res.writeHead(200, { 'Content-Type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await startServer(Number(process.env.PORT || 8765));
  console.log(`Gargantua: http://127.0.0.1:${server.address().port}`);
}
