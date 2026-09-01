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
    const type = types[path.extname(file)] || 'application/octet-stream';
    // Range support: without it, seeking audio/video (Pause+resume, scrubbing the
    // timeline) forces the browser to refetch from byte 0 and playback jumps to the start.
    const range = req.headers.range;
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match){
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = Math.min(match[2] ? parseInt(match[2], 10) : st.size - 1, st.size - 1);
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1,
                           'content-range': `bytes ${start}-${end}/${st.size}`,
                           'accept-ranges': 'bytes', 'cache-control': 'no-store' });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size,
                         'accept-ranges': 'bytes', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(8777, () => console.log('serving on http://localhost:8777'));
