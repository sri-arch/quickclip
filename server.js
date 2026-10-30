/**
 * QuickClip - Backend Server
 * High-performance, zero-external-dependency REST API & Static File Server
 * Powered by Node.js built-ins (`node:http`, `node:fs`, `node:path`, `node:sqlite`)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const db = require('./db.js');

// Configuration
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = __dirname;

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * Send JSON response helper
 */
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(payload);
}

/**
 * Send Error response helper
 */
function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

/**
 * Parse incoming JSON body
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    const MAX_SIZE = 2 * 1024 * 1024; // 2MB limit for snippets

    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_SIZE) {
        reject(new Error('Payload too large. Maximum 2MB allowed.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON format: ' + err.message));
      }
    });

    req.on('error', err => reject(err));
  });
}

/**
 * Static file server handler
 */
function handleStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  
  // Normalize and secure against path traversal
  const safePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!safePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, 'Forbidden access.');
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return sendError(res, 404, 'File not found');
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  });
}

/**
 * Main HTTP Request Router
 */
async function requestHandler(req, res) {
  const startTime = Date.now();

  // Set CORS headers for all pre-flight checks
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // Parse URL & Query parameters
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  // Log on finish
  res.on('finish', () => {
    const elapsed = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${method} ${pathname} -> ${res.statusCode} (${elapsed}ms)`);
  });

  try {
    // =========================================================================
    // REST API ROUTES
    // =========================================================================

    // Healthcheck
    if (pathname === '/api/health' && method === 'GET') {
      const stats = db.getStats();
      return sendJson(res, 200, {
        status: 'ok',
        service: 'QuickClip Backend',
        database: 'SQLite (WAL Mode)',
        uptime: process.uptime(),
        totalClips: stats.total,
        timestamp: Date.now()
      });
    }

    // Vault Stats
    if (pathname === '/api/stats' && method === 'GET') {
      const stats = db.getStats();
      return sendJson(res, 200, stats);
    }

    // List Clips: GET /api/clips
    if (pathname === '/api/clips' && method === 'GET') {
      const category = reqUrl.searchParams.get('category');
      const search = reqUrl.searchParams.get('search');
      const limit = reqUrl.searchParams.get('limit');
      const offset = reqUrl.searchParams.get('offset');

      const clips = db.getAllClips({ category, search, limit, offset });
      return sendJson(res, 200, {
        clips,
        count: clips.length
      });
    }

    // Create Clip: POST /api/clips
    if (pathname === '/api/clips' && method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
        return sendError(res, 400, 'Text content is required.');
      }

      const result = db.createClip(body);
      const statusCode = result.action === 'created' ? 201 : 200;
      return sendJson(res, statusCode, result);
    }

    // Clear Unpinned Clips: POST /api/clips/clear-unpinned OR DELETE /api/clips/unpinned
    if (
      (pathname === '/api/clips/clear-unpinned' && method === 'POST') ||
      (pathname === '/api/clips/unpinned' && method === 'DELETE')
    ) {
      const removedCount = db.clearUnpinned();
      return sendJson(res, 200, {
        success: true,
        clearedCount: removedCount,
        message: `Successfully cleared ${removedCount} unpinned snippet(s).`
      });
    }

    // Single Clip operations with ID: /api/clips/:id
    const clipMatch = pathname.match(/^\/api\/clips\/([^/]+)$/);
    if (clipMatch) {
      const clipId = decodeURIComponent(clipMatch[1]);

      // GET /api/clips/:id
      if (method === 'GET') {
        const clip = db.getClipById(clipId);
        if (!clip) return sendError(res, 404, 'Clip not found');
        return sendJson(res, 200, clip);
      }

      // PATCH or PUT /api/clips/:id
      if (method === 'PATCH' || method === 'PUT') {
        const body = await parseJsonBody(req);
        const updated = db.updateClip(clipId, body);
        if (!updated) return sendError(res, 404, 'Clip not found');
        return sendJson(res, 200, updated);
      }

      // DELETE /api/clips/:id
      if (method === 'DELETE') {
        const deleted = db.deleteClip(clipId);
        if (!deleted) return sendError(res, 404, 'Clip not found');
        return sendJson(res, 200, { success: true, id: clipId });
      }
    }

    // Toggle Pin: POST /api/clips/:id/pin
    const pinMatch = pathname.match(/^\/api\/clips\/([^/]+)\/pin$/);
    if (pinMatch && method === 'POST') {
      const clipId = decodeURIComponent(pinMatch[1]);
      const updated = db.togglePin(clipId);
      if (!updated) return sendError(res, 404, 'Clip not found');
      return sendJson(res, 200, updated);
    }

    // Optional Clipboard sync bridge: GET /api/clipboard
    if (pathname === '/api/clipboard' && method === 'GET') {
      return sendJson(res, 200, {
        available: true,
        hint: 'Use navigator.clipboard or paste directly. Server sync ready.'
      });
    }

    // =========================================================================
    // STATIC ASSETS
    // =========================================================================
    if (method === 'GET') {
      return handleStaticFile(req, res, pathname);
    }

    // Route not found
    return sendError(res, 404, `Endpoint ${method} ${pathname} not found.`);

  } catch (err) {
    console.error('Request processing error:', err);
    return sendError(res, 500, err.message || 'Internal Server Error');
  }
}

/**
 * Start Server
 */
function startServer(port = PORT, host = HOST) {
  // Ensure database is initialized
  db.initDatabase();

  const server = http.createServer(requestHandler);

  server.listen(port, host, () => {
    console.log('='.repeat(56));
    console.log(`  QuickClip Vault Backend is running!`);
    console.log(`  - Local URL:   http://localhost:${port}`);
    console.log(`  - Network URL: http://${host}:${port}`);
    console.log(`  - Database:    ${db.DB_PATH}`);
    console.log(`  - Healthcheck: http://localhost:${port}/api/health`);
    console.log('='.repeat(56));
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  requestHandler
};

