const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'data', 'app.db');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initDb();
  }
});

function initDb() {
  db.serialize(() => {
    // Settings table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    // Navidrome Accounts table
    db.run(`CREATE TABLE IF NOT EXISTS navidrome_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_or_token TEXT NOT NULL,
      salt TEXT
    )`);

    // History (Recommended & Queued/Downloaded)
    db.run(`CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT,
      title TEXT,
      artist TEXT,
      album TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'recommended', -- recommended, queued, downloaded, failed
      recommended_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Dislikes
    db.run(`CREATE TABLE IF NOT EXISTS dislikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, -- 'track' or 'artist'
      name TEXT NOT NULL,
      artist TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Neural Weights
    db.run(`CREATE TABLE IF NOT EXISTS weights (
      feature TEXT PRIMARY KEY,
      weight REAL NOT NULL
    )`);

    // Default Weights
    db.run(`INSERT OR IGNORE INTO weights (feature, weight) VALUES 
      ('source_similar', 10.0),
      ('source_trending', 5.0),
      ('source_search', 8.0),
      ('source_favorite_artist', 15.0),
      ('source_top_artist', 12.0),
      ('llm_mood_match', 2.0),
      ('llm_profile_match', 1.5)
    `);

    // Recommendation Features
    db.run(`CREATE TABLE IF NOT EXISTS recommendation_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      history_id INTEGER NOT NULL,
      feature TEXT NOT NULL,
      value REAL NOT NULL,
      weight_at_time REAL NOT NULL,
      FOREIGN KEY(history_id) REFERENCES history(id)
    )`);
  });
}

// Utility wrappers for async/await
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const getSetting = async (key, defaultValue = null) => {
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : defaultValue;
};

const setSetting = async (key, value) => {
  await dbRun('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
};

// Neural Weight helpers
const getWeights = async () => {
  const rows = await dbAll('SELECT feature, weight FROM weights');
  const weights = {};
  for (const row of rows) {
    weights[row.feature] = row.weight;
  }
  return weights;
};

const updateWeight = async (feature, delta) => {
  await dbRun('UPDATE weights SET weight = weight + ? WHERE feature = ?', [delta, feature]);
};

module.exports = {
  db,
  dbRun,
  dbGet,
  dbAll,
  getSetting,
  setSetting,
  getWeights,
  updateWeight
};
