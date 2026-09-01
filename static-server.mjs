// ponytail: dev-only static server; python3 -m http.server can't getcwd() under this sandbox
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const types = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.wav':'audio/wav', '.mp3':'audio/mpeg', '.glb':'model/gltf-binary',
                '.png':'image/png', '.jpg':'image/jpeg', '.css':'text/css', '.txt':'text/plain' };
http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream',
                         'content-length': st.size, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(8777, () => console.log('serving on http://localhost:8777'));
