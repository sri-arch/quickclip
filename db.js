/**
 * QuickClip - SQLite Database Layer
 * Built with Node.js native `node:sqlite` (DatabaseSync)
 * Provides persistent ACID storage with zero external dependencies.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Database path from environment or default local quickclip.db
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'quickclip.db');

// Regular Expressions for Auto-Categorization
const RegexPatterns = {
  colorHex: /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/,
  colorRgbHsl: /^(rgb|hsl)a?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(\s*,\s*[\d.]+%?)?\s*\)$/i,
  link: /^(https?:\/\/[^\s]+)$/i,
  codeKeywords: /\b(function|const|let|var|import|export|from|return|async|await|class|interface|type|extends|implements|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|GROUP BY|ORDER BY|def|elif|lambda|echo|public|private|protected|struct|fn|val)\b/,
  codeStructures: /(<\/[a-z0-9]+>|<[a-z0-9]+(\s+[^>]*)?>|=>|\{[^]*\}|\[[^]*\]|console\.(log|error|warn)|;\s*$)/m
};

/**
 * Classify text into Color, Link, Code, or Text.
 * @param {string} rawText
 * @returns {'Color' | 'Link' | 'Code' | 'Text'}
 */
function categorizeText(rawText) {
  if (!rawText) return 'Text';
  const trimmed = rawText.trim();

  // 1. Color Check
  if (RegexPatterns.colorHex.test(trimmed) || RegexPatterns.colorRgbHsl.test(trimmed)) {
    return 'Color';
  }

  // 2. Link Check
  if (RegexPatterns.link.test(trimmed)) {
    return 'Link';
  }

  // 3. Code Check
  const hasKeywords = RegexPatterns.codeKeywords.test(trimmed);
  const hasStructures = RegexPatterns.codeStructures.test(trimmed);
  const hasMultipleLines = trimmed.includes('\n');
  const hasCodePunctuation = /[{};()=>]/.test(trimmed);

  if ((hasKeywords && hasCodePunctuation) || (hasStructures && (hasKeywords || hasMultipleLines))) {
    return 'Code';
  }

  return 'Text';
}

// Initial Seed Data for first run
const SEED_DATA = [
  {
    id: 'seed-1',
    text: '#E07A5F',
    category: 'Color',
    isPinned: 1,
    createdAt: Date.now() - 1000 * 60 * 12
  },
  {
    id: 'seed-2',
    text: 'const saveVault = (items) => {\n  localStorage.setItem("quickclip_vault_data", JSON.stringify(items));\n};',
    category: 'Code',
    isPinned: 1,
    createdAt: Date.now() - 1000 * 60 * 45
  },
  {
    id: 'seed-3',
    text: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API',
    category: 'Link',
    isPinned: 0,
    createdAt: Date.now() - 1000 * 60 * 120
  },
  {
    id: 'seed-4',
    text: 'Welcome to QuickClip. Press "Sync Clipboard" or press Ctrl+V anywhere to capture snippets automatically.',
    category: 'Text',
    isPinned: 0,
    createdAt: Date.now() - 1000 * 60 * 360
  }
];

let dbInstance = null;

/**
 * Initialize SQLite database and tables
 */
function initDatabase(customPath) {
  const targetPath = customPath || DB_PATH;
  
  // Ensure directory exists if not in current folder
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(targetPath);

  // Enable WAL mode for high performance concurrency
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Create clips table
  db.exec(`
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      category TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clips_pinned ON clips(is_pinned);
    CREATE INDEX IF NOT EXISTS idx_clips_category ON clips(category);
  `);

  // Check if table is empty, seed initial data
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM clips');
  const result = countStmt.get();

  if (result.count === 0) {
    const insertSeed = db.prepare(`
      INSERT INTO clips (id, text, category, is_pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of SEED_DATA) {
      insertSeed.run(item.id, item.text, item.category, item.isPinned, item.createdAt, item.createdAt);
    }
  }

  dbInstance = db;
  return db;
}

/**
 * Get or create database instance
 */
function getDb() {
  if (!dbInstance) {
    initDatabase();
  }
  return dbInstance;
}

/**
 * Format a database row into a standardized clip object
 */
function formatClipRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    category: row.category,
    isPinned: Boolean(row.is_pinned),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

/**
 * Get all clips with optional filtering and search
 */
function getAllClips(options = {}) {
  const db = getDb();
  const { category, search, limit, offset } = options;

  let query = 'SELECT * FROM clips WHERE 1=1';
  const params = [];

  if (category && category !== 'all') {
    query += ' AND LOWER(category) = LOWER(?)';
    params.push(category);
  }

  if (search && search.trim()) {
    query += ' AND (LOWER(text) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?))';
    const wildcard = `%${search.trim()}%`;
    params.push(wildcard, wildcard);
  }

  // Pinned items first, then newest first
  query += ' ORDER BY is_pinned DESC, created_at DESC';

  if (limit && Number.isInteger(Number(limit))) {
    query += ' LIMIT ?';
    params.push(Number(limit));
    if (offset && Number.isInteger(Number(offset))) {
      query += ' OFFSET ?';
      params.push(Number(offset));
    }
  }

  const stmt = db.prepare(query);
  const rows = stmt.all(...params);
  return rows.map(formatClipRow);
}

/**
 * Get a single clip by ID
 */
function getClipById(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM clips WHERE id = ?');
  const row = stmt.get(id);
  return formatClipRow(row);
}

/**
 * Find an existing clip by exact text
 */
function findClipByText(text) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM clips WHERE trim(text) = trim(?) LIMIT 1');
  const row = stmt.get(text);
  return formatClipRow(row);
}

/**
 * Create a new clip or bump existing duplicate to top
 */
function createClip(clipData) {
  const db = getDb();
  const rawText = (clipData.text || '').trim();
  if (!rawText) {
    throw new Error('Clip text cannot be empty');
  }

  // Check if identical snippet already exists
  const existing = findClipByText(rawText);
  const now = Date.now();

  if (existing) {
    // Bump existing clip timestamp to now so it appears at top
    const updateStmt = db.prepare(`
      UPDATE clips 
      SET created_at = ?, updated_at = ? 
      WHERE id = ?
    `);
    updateStmt.run(now, now, existing.id);

    return {
      action: 'updated',
      clip: getClipById(existing.id)
    };
  }

  const category = (clipData.category && clipData.category !== 'auto')
    ? clipData.category
    : categorizeText(rawText);

  const isPinned = clipData.isPinned ? 1 : 0;
  const id = clipData.id || 'clip-' + now + '-' + Math.random().toString(36).substring(2, 7);

  const insertStmt = db.prepare(`
    INSERT INTO clips (id, text, category, is_pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(id, rawText, category, isPinned, now, now);

  return {
    action: 'created',
    clip: getClipById(id)
  };
}

/**
 * Update an existing clip
 */
function updateClip(id, updates = {}) {
  const db = getDb();
  const existing = getClipById(id);
  if (!existing) {
    return null;
  }

  const newText = updates.text !== undefined ? updates.text.trim() : existing.text;
  if (!newText) {
    throw new Error('Clip text cannot be empty');
  }

  const newCategory = updates.category !== undefined 
    ? updates.category 
    : (updates.text !== undefined ? categorizeText(newText) : existing.category);

  const newPinned = updates.isPinned !== undefined ? (updates.isPinned ? 1 : 0) : (existing.isPinned ? 1 : 0);
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE clips
    SET text = ?, category = ?, is_pinned = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(newText, newCategory, newPinned, now, id);
  return getClipById(id);
}

/**
 * Toggle pin status of a clip
 */
function togglePin(id) {
  const db = getDb();
  const existing = getClipById(id);
  if (!existing) {
    return null;
  }

  const newPinned = existing.isPinned ? 0 : 1;
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE clips 
    SET is_pinned = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(newPinned, now, id);
  return getClipById(id);
}

/**
 * Delete a clip by ID
 */
function deleteClip(id) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM clips WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Clear all unpinned clips
 */
function clearUnpinned() {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM clips WHERE is_pinned = 0');
  const result = stmt.run();
  return result.changes;
}

/**
 * Get vault summary statistics
 */
function getStats() {
  const db = getDb();

  const totalStmt = db.prepare('SELECT COUNT(*) as count FROM clips');
  const total = totalStmt.get().count;

  const pinnedStmt = db.prepare('SELECT COUNT(*) as count FROM clips WHERE is_pinned = 1');
  const pinned = pinnedStmt.get().count;

  const categoriesStmt = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM clips
    GROUP BY category
  `);
  const catRows = categoriesStmt.all();

  const categories = {
    Code: 0,
    Link: 0,
    Color: 0,
    Text: 0
  };

  for (const row of catRows) {
    if (categories[row.category] !== undefined) {
      categories[row.category] = row.count;
    }
  }

  return {
    total,
    pinned,
    unpinned: total - pinned,
    categories
  };
}

module.exports = {
  DB_PATH,
  categorizeText,
  initDatabase,
  getDb,
  getAllClips,
  getClipById,
  findClipByText,
  createClip,
  updateClip,
  togglePin,
  deleteClip,
  clearUnpinned,
  getStats
};

