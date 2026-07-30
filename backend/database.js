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
    // Enable WAL mode for better concurrency and prevent SQLITE_BUSY
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA synchronous = NORMAL;');
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
      account_id INTEGER,
      track_id TEXT,
      title TEXT,
      artist TEXT,
      album TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'recommended', -- recommended, queued, downloaded, failed
      hidden INTEGER DEFAULT 0,
      recommended_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Dislikes
    db.run(`CREATE TABLE IF NOT EXISTS dislikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      type TEXT, -- 'track' or 'artist'
      name TEXT NOT NULL,
      artist TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Verified Artists
    db.run(`CREATE TABLE IF NOT EXISTS verified_artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      itunes_id TEXT NOT NULL,
      genre TEXT,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Neural Weights (Multi-User)
    db.run(`CREATE TABLE IF NOT EXISTS weights (
      account_id INTEGER NOT NULL,
      feature TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (account_id, feature)
    )`);

    // Migrations
    db.get("SELECT account_id FROM weights LIMIT 1", (err) => {
      if (err) {
        // The column doesn't exist, which means it's the old schema
        console.log('Migrating weights table to multi-user architecture...');
        db.serialize(() => {
          db.run('DROP TABLE IF EXISTS weights');
          db.run(`CREATE TABLE weights (
            account_id INTEGER NOT NULL,
            feature TEXT NOT NULL,
            weight REAL NOT NULL,
            PRIMARY KEY (account_id, feature)
          )`);
          
          db.all('SELECT id FROM navidrome_accounts', (err, accounts) => {
            if (!err && accounts) {
              const stmt = db.prepare('INSERT INTO weights (account_id, feature, weight) VALUES (?, ?, ?)');
              const defaultWeights = [
                ['source_similar', 1.0], ['source_trending', 0.5], ['source_search', 0.8],
                ['source_favorite_artist', 1.5], ['source_top_artist', 1.2],
                ['llm_mood_match', 2.0], ['llm_profile_match', 1.5], ['bias', 0.0]
              ];
              accounts.forEach(acc => {
                defaultWeights.forEach(dw => {
                  stmt.run(acc.id, dw[0], dw[1]);
                });
              });
              stmt.finalize();
            }
          });
        });
      }
    });

    db.run("ALTER TABLE history ADD COLUMN account_id INTEGER", (err) => {});
    db.run("ALTER TABLE dislikes ADD COLUMN account_id INTEGER", (err) => {});
    db.run("ALTER TABLE history ADD COLUMN hidden INTEGER DEFAULT 0", (err) => {});

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
const initializeWeightsForAccount = async (accountId) => {
  const defaultWeights = [
    ['source_similar', 1.0], ['source_trending', 0.5], ['source_search', 0.8],
    ['source_favorite_artist', 1.5], ['source_top_artist', 1.2],
    ['llm_mood_match', 2.0], ['llm_profile_match', 1.5], ['bias', 0.0]
  ];
  for (const dw of defaultWeights) {
    await dbRun('INSERT OR IGNORE INTO weights (account_id, feature, weight) VALUES (?, ?, ?)', [accountId, dw[0], dw[1]]);
  }
};

const getWeights = async (accountId) => {
  // Ensure weights exist for this account (e.g. if newly added)
  await initializeWeightsForAccount(accountId);
  
  const rows = await dbAll('SELECT feature, weight FROM weights WHERE account_id = ?', [accountId]);
  const weights = {};
  for (const row of rows) {
    weights[row.feature] = row.weight;
  }
  return weights;
};

const updateWeight = async (accountId, feature, delta) => {
  await dbRun('UPDATE weights SET weight = weight + ? WHERE account_id = ? AND feature = ?', [delta, accountId, feature]);
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
