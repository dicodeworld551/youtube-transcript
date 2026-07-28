const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { extractVideoId, getTranscript } = require('./src/transcript');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(payload));
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const safePath = path.normalize(pathname).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    throw error;
  }
}

async function handleTranscript(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const youtubeUrl = requestUrl.searchParams.get('url');
  const lang = requestUrl.searchParams.get('lang') || undefined;

  if (!youtubeUrl) {
    sendJson(res, 400, { error: 'Please provide a YouTube URL.' });
    return;
  }

  try {
    const videoId = extractVideoId(youtubeUrl);
    const transcript = await getTranscript(videoId, { lang });
    sendJson(res, 200, transcript);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || 'Unable to fetch transcript.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url.startsWith('/api/transcript')) {
      await handleTranscript(req, res);
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Unexpected server error.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`YouTube transcript downloader running at http://localhost:${PORT}`);
  });
}

module.exports = server;
