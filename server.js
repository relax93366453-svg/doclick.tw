const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const PORT = 8765;
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('找不到 config.json，請關閉視窗後重新執行「啟動愜易居系統.bat」。');
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
  const config = JSON.parse(raw);
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(String(config.apiUrl || ''))) {
    throw new Error('config.json 的 apiUrl 不是正確的 Apps Script /exec 網址。');
  }
  if (!String(config.token || '').trim()) {
    throw new Error('config.json 尚未設定 JOB_ADMIN_TOKEN。');
  }
  return { apiUrl: String(config.apiUrl).trim(), token: String(config.token).trim() };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function requestUpstream(urlString, options = {}, body = null, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Google API 重新導向次數過多'));
    const target = new URL(urlString);
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'DoclickLocalProxy/1.0',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Encoding': 'identity',
        ...(options.headers || {})
      }
    }, (upstream) => {
      const location = upstream.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(upstream.statusCode)) {
        upstream.resume();
        const nextUrl = new URL(location, target).toString();
        const nextMethod = [301, 302, 303].includes(upstream.statusCode) ? 'GET' : (options.method || 'GET');
        return resolve(requestUpstream(nextUrl, { method: nextMethod }, nextMethod === 'GET' ? null : body, redirects + 1));
      }
      const chunks = [];
      upstream.on('data', chunk => chunks.push(chunk));
      upstream.on('end', () => resolve({
        status: upstream.statusCode || 500,
        headers: upstream.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Google API 連線逾時')));
    if (body) req.write(body);
    req.end();
  });
}

async function handleJobApi(req, res) {
  try {
    const config = loadConfig();
    const incoming = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET') {
      const target = new URL(config.apiUrl);
      incoming.searchParams.forEach((value, key) => {
        if (key !== 'token') target.searchParams.set(key, value);
      });
      if (target.searchParams.get('action') === 'all') {
        target.searchParams.set('token', config.token);
      }
      const result = await requestUpstream(target.toString(), { method: 'GET' });
      res.writeHead(result.status, {
        'Content-Type': result.headers['content-type'] || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(result.body);
    }

    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const incomingBody = Buffer.concat(chunks).toString('utf8');
      const form = new URLSearchParams(incomingBody);
      form.set('token', config.token);
      const body = form.toString();
      const result = await requestUpstream(config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Content-Length': Buffer.byteLength(body)
        }
      }, body);
      res.writeHead(result.status, {
        'Content-Type': result.headers['content-type'] || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(result.body);
    }

    sendJson(res, 405, { ok: false, message: '不支援的請求方式' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, message: error.message || String(error) });
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, '.' + pathname);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    return sendJson(res, 403, { ok: false, message: '拒絕存取' });
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { ok: false, message: '找不到檔案' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/job-api')) return handleJobApi(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('===============================================');
  console.log(' 愜易居管理系統已啟動');
  console.log(` 網址：http://${HOST}:${PORT}/index.html`);
  console.log(' 請保持此黑色視窗開啟；關閉後系統會停止。');
  console.log('===============================================');
  console.log('');
});
