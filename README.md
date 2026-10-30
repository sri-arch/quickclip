# QuickClip - Local Clipboard Vault & Snippet Manager

A warm, minimalist clipboard vault and snippet manager powered by a lightweight, zero-dependency Node.js backend with native SQLite persistence.

---

## Architecture Overview

```
quickclip/
├── db.js              # SQLite database layer using Node.js native `node:sqlite` (DatabaseSync)
├── server.js          # REST API & Static Asset Server (zero external dependencies)
├── test-backend.js    # Automated End-to-End API and database test suite
├── package.json       # Scripts and project metadata
├── start.bat          # 1-click Windows launcher
├── index.html         # Vault UI layout and semantic HTML structure
├── styles.css         # Warm minimalist design system
├── app.js             # Client-side controller connecting UI to the Backend REST API
└── quickclip.db       # Persistent SQLite database (auto-created on first run)
```

---

## Features

- **Persistent SQLite Database (`quickclip.db`)**:
  - ACID transactions, write-ahead logging (WAL mode), indexing on timestamps, categories, and pin states.
  - Initial seed data automatically loaded on fresh installs.
- **Auto-Categorization Engine**:
  - Automatically identifies **Color** (Hex, RGB, HSL), **Link** (URLs), **Code** (syntax & keywords), or **Text**.
- **RESTful API**:
  - Full CRUD operations with JSON payloads, duplicate prevention, and timestamp bumping.
- **Live Sync & Dual-Mode Resilience**:
  - UI seamlessly interacts with the SQLite backend.
  - Visual status indicator in the header: **SQLite Backend Active** (green status pulse) or graceful **Local Cache (Offline)** fallback if server is not running.
- **Zero External Dependencies**:
  - Uses native Node.js capabilities (`node:http`, `node:sqlite`, `node:fs`, `node:path`). No `npm install` needed!

---

## Quick Start

### 1. Start the Backend Server

Using npm:
```bash
npm start
```

Or directly using Node.js:
```bash
node server.js
```

Or double-click `start.bat` on Windows.

The backend will start and display:
```
========================================================
  QuickClip Vault Backend is running!
  - Local URL:   http://localhost:3000
  - Network URL: http://0.0.0.0:3000
  - Database:    .../quickclip.db
  - Healthcheck: http://localhost:3000/api/health
========================================================
```

### 2. Open the App in Your Browser

Open [http://localhost:3000](http://localhost:3000) in your browser. All your snippets are saved directly into the SQLite database.

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Healthcheck & database connection status |
| `GET` | `/api/stats` | Vault statistics (total, pinned, unpinned, category counts) |
| `GET` | `/api/clips` | Fetch all clips. Supports `?category=Code` and `?search=query` |
| `GET` | `/api/clips/:id` | Fetch a single clip by its ID |
| `POST` | `/api/clips` | Add a new clip (or bump duplicate). Body: `{"text": "..."}` |
| `PATCH` | `/api/clips/:id` | Update a clip's text, category, or pin status |
| `POST` | `/api/clips/:id/pin` | Toggle pin status of a clip |
| `DELETE` | `/api/clips/:id` | Delete a single clip |
| `POST` | `/api/clips/clear-unpinned` | Clear all unpinned snippets in one call |
| `GET` | `/api/clipboard` | Host clipboard service probe |

---

## Running Automated Tests

Run the test suite to verify database operations and API endpoints:
```bash
npm test
```
or:
```bash
node test-backend.js
```
All 12 tests validate table creation, seeding, auto-categorization, duplicate handling, pinning, filtering, deletion, and static serving.

