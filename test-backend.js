/**
 * QuickClip Backend Test Suite
 * Validates SQLite initialization, REST API CRUD endpoints, categorization,
 * and error handling.
 */

const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// Use a temporary test database file
const TEST_DB = path.join(__dirname, 'test_quickclip.db');
process.env.DATABASE_PATH = TEST_DB;

// Clean up any previous test database
if (fs.existsSync(TEST_DB)) {
  fs.unlinkSync(TEST_DB);
}

const db = require('./db.js');
const { startServer } = require('./server.js');

const TEST_PORT = 3999;
let server;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting QuickClip Backend Test Suite ---');
  
  // 1. Initialize server on test port
  server = startServer(TEST_PORT);
  await new Promise(r => setTimeout(r, 200));

  try {
    // 2. Healthcheck Test
    console.log('[Test 1] GET /api/health');
    const health = await request('GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.status, 'ok');
    assert.strictEqual(health.body.service, 'QuickClip Backend');
    console.log('✓ Health check passed');

    // 3. Initial Seed Data Test
    console.log('[Test 2] GET /api/clips (Seed Data)');
    const clipsRes = await request('GET', '/api/clips');
    assert.strictEqual(clipsRes.status, 200);
    assert.ok(clipsRes.body.clips.length >= 4, 'Should contain seed clips');
    console.log(`✓ Seed clips retrieved: ${clipsRes.body.clips.length} clips`);

    // 4. Create Clip with Auto-Categorization (Color)
    console.log('[Test 3] POST /api/clips (Color Auto-Detection)');
    const createColor = await request('POST', '/api/clips', { text: '#3A86FF' });
    assert.strictEqual(createColor.status, 201);
    assert.strictEqual(createColor.body.clip.category, 'Color');
    assert.strictEqual(createColor.body.clip.text, '#3A86FF');
    console.log('✓ Color clip auto-categorized correctly');

    // 5. Create Clip with Auto-Categorization (Link)
    console.log('[Test 4] POST /api/clips (Link Auto-Detection)');
    const createLink = await request('POST', '/api/clips', { text: 'https://nodejs.org/api/sqlite.html' });
    assert.strictEqual(createLink.status, 201);
    assert.strictEqual(createLink.body.clip.category, 'Link');
    console.log('✓ Link clip auto-categorized correctly');

    // 6. Create Clip with Auto-Categorization (Code)
    console.log('[Test 5] POST /api/clips (Code Auto-Detection)');
    const createCode = await request('POST', '/api/clips', { text: 'const express = require("express");\napp.listen(3000);' });
    assert.strictEqual(createCode.status, 201);
    assert.strictEqual(createCode.body.clip.category, 'Code');
    console.log('✓ Code clip auto-categorized correctly');

    // 7. Duplicate Handling (Timestamp bump)
    console.log('[Test 6] POST /api/clips (Duplicate snippet bump)');
    const duplicate = await request('POST', '/api/clips', { text: '#3A86FF' });
    assert.strictEqual(duplicate.status, 200);
    assert.strictEqual(duplicate.body.action, 'updated');
    assert.strictEqual(duplicate.body.clip.id, createColor.body.clip.id);
    console.log('✓ Duplicate snippet correctly identified and bumped');

    // 8. Toggle Pin
    console.log('[Test 7] POST /api/clips/:id/pin');
    const pinRes = await request('POST', `/api/clips/${createColor.body.clip.id}/pin`);
    assert.strictEqual(pinRes.status, 200);
    assert.strictEqual(pinRes.body.isPinned, true);
    console.log('✓ Pin toggled successfully');

    // 9. Search & Filter
    console.log('[Test 8] GET /api/clips?category=Color&search=3A86FF');
    const filterRes = await request('GET', '/api/clips?category=Color&search=3A86FF');
    assert.strictEqual(filterRes.status, 200);
    assert.strictEqual(filterRes.body.clips.length, 1);
    assert.strictEqual(filterRes.body.clips[0].text, '#3A86FF');
    console.log('✓ Search and category filtering passed');

    // 10. Delete Clip
    console.log('[Test 9] DELETE /api/clips/:id');
    const delRes = await request('DELETE', `/api/clips/${createCode.body.clip.id}`);
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.body.success, true);
    console.log('✓ Clip deleted successfully');

    // 11. Clear Unpinned
    console.log('[Test 10] POST /api/clips/clear-unpinned');
    const clearRes = await request('POST', '/api/clips/clear-unpinned');
    assert.strictEqual(clearRes.status, 200);
    assert.strictEqual(clearRes.body.success, true);
    console.log(`✓ Cleared unpinned clips (${clearRes.body.clearedCount} clips removed)`);

    // Verify pinned clips remain
    const remainingClips = await request('GET', '/api/clips');
    for (const clip of remainingClips.body.clips) {
      assert.strictEqual(clip.isPinned, true, 'All remaining clips must be pinned');
    }
    console.log('✓ Verified only pinned clips remain in database');

    // 12. Vault Statistics
    console.log('[Test 11] GET /api/stats');
    const statsRes = await request('GET', '/api/stats');
    assert.strictEqual(statsRes.status, 200);
    assert.ok(statsRes.body.pinned >= 1);
    assert.strictEqual(statsRes.body.unpinned, 0);
    console.log('✓ Vault stats returned accurate totals');

    // 13. Static file serving check
    console.log('[Test 12] GET / (Static asset: index.html)');
    const indexRes = await request('GET', '/');
    assert.strictEqual(indexRes.status, 200);
    assert.ok(indexRes.raw.includes('QuickClip'));
    console.log('✓ Static asset serving verified');

    console.log('\n==============================================');
    console.log('  ALL 12 BACKEND TESTS PASSED SUCCESSFULLY!  ');
    console.log('==============================================');

  } finally {
    server.close();
    // Clean up test DB
    try {
      if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
      if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
      if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
    } catch (_) {}
  }
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

