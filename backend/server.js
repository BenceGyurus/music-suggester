const express = require('express');
const cors = require('cors');
const path = require('path');
const { dbRun, dbAll, getSetting, setSetting } = require('./database');
const { initScheduler, runRecommendationJob } = require('./services/scheduler');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Start background jobs
initScheduler();

// --- Settings API ---
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await dbAll('SELECT key, value FROM settings');
    const result = {};
    settings.forEach(s => result[s.key] = s.value);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    await setSetting(key, value);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Navidrome Accounts API ---
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await dbAll('SELECT id, url, username, salt FROM navidrome_accounts');
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const { url, username, password_or_token, salt } = req.body;
    await dbRun('INSERT INTO navidrome_accounts (url, username, password_or_token, salt) VALUES (?, ?, ?, ?)', 
      [url, username, password_or_token, salt || null]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM navidrome_accounts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Recommendations API ---
app.get('/api/recommendations', async (req, res) => {
  try {
    // Return all tracks that are not failed or downloaded, plus recent ones
    const limit = parseInt(req.query.limit) || 20;
    const tracks = await dbAll("SELECT * FROM history WHERE status != 'failed' ORDER BY recommended_at DESC LIMIT ?", [limit]);
    res.json(tracks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/recommendations/trigger', async (req, res) => {
  try {
    // Run async, don't wait
    runRecommendationJob();
    res.json({ success: true, message: 'Recommendation job triggered.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Dislikes API ---
app.post('/api/dislike', async (req, res) => {
  try {
    const { id, type, name, artist } = req.body;
    
    // Save to dislikes
    await dbRun('INSERT INTO dislikes (type, name, artist) VALUES (?, ?, ?)', [type, name, artist || null]);
    
    // Remove from history if it's there
    if (id) {
        await dbRun('DELETE FROM history WHERE id = ?', [id]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Actions API ---
app.post('/api/download/:id', async (req, res) => {
  try {
    await dbRun("UPDATE history SET status = 'queued' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// React Router fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
