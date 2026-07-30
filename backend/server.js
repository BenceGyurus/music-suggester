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
    // Return all tracks so the frontend can display their status (including failed ones)
    const limit = parseInt(req.query.limit) || 20;
    const tracks = await dbAll(`
      SELECT h.*, a.username as account_username 
      FROM history h 
      LEFT JOIN navidrome_accounts a ON h.account_id = a.id 
      ORDER BY h.recommended_at DESC 
      LIMIT ?
    `, [limit]);
    res.json(tracks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post('/api/recommendations/hide/:id', async (req, res) => {
  try {
    const { hidden } = req.body;
    await dbRun('UPDATE history SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, req.params.id]);
    res.json({ success: true });
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

// --- OpenRouter Models API ---
app.get('/api/models', async (req, res) => {
  try {
    const openRouterKey = await getSetting('openrouter_key');
    if (!openRouterKey) {
      return res.json([]);
    }
    
    // Using dynamic import for axios just to be safe if it's already used elsewhere, but we can require it at top.
    const axios = require('axios');
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${openRouterKey}`
      }
    });
    
    // Sort alphabetically by ID
    const models = response.data.data.sort((a, b) => a.id.localeCompare(b.id));
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Dislikes API ---
app.post('/api/dislike', async (req, res) => {
  try {
    console.log('[API] /dislike called with body:', req.body);
    const { id, type, name, artist } = req.body;
    
    let accountId = 0;
    if (id) {
        // Fetch the account ID that this history row belongs to
        const historyRow = await dbGet('SELECT account_id FROM history WHERE id = ?', [id]);
        if (historyRow && historyRow.account_id) {
            accountId = historyRow.account_id;
        }
    }

    // Save to dislikes
    console.log('[API] Saving to dislikes table');
    await dbRun('INSERT INTO dislikes (account_id, type, name, artist) VALUES (?, ?, ?, ?)', [accountId, type, name, artist || null]);
    
    // Attempt to delete local file if it exists
    if (type === 'track' && name) {
      console.log(`[API] Attempting to delete local file for ${artist} - ${name}`);
      const { deleteLocalFile } = require('./services/fileSearch');
      await deleteLocalFile(artist, name);
    }
    
    if (id) {
        console.log(`[API] Hiding track from dashboard for id: ${id}`);
        // Hide by ID and also hide any duplicates by same artist + title
        await dbRun('UPDATE history SET hidden = 1 WHERE id = ?', [id]);
        if (artist && name) {
            await dbRun('UPDATE history SET hidden = 1 WHERE artist = ? AND title = ?', [artist, name]);
        }
        console.log(`[API] Successfully hidden track ${id}`);
    } else {
        console.log(`[API] Warning: no ID provided, cannot hide from history!`);
    }
    
    if (id && accountId) {
        // Backpropagation: Gradient Descent
        const { getWeights, updateWeight } = require('./database');
        const weights = await getWeights(accountId);
        const features = await dbAll('SELECT feature, value FROM recommendation_features WHERE history_id = ?', [id]);
        
        // 1. Reconstruct Sum
        let sum = weights['bias'] || 0.0;
        for (const f of features) {
          sum += (weights[f.feature] || 0) * f.value;
        }

        // 2. Calculate Sigmoid Score
        const score = 1 / (1 + Math.exp(-sum));

        // 3. Calculate Gradient for Dislike (Target = 0.0)
        // Error = (Score - Target) = Score
        const error = score;
        const gradient = score * (1 - score);
        const learningRate = 1.0; // Higher learning rate for noticeable immediate effect

        for (const f of features) {
            // Delta W = - LearningRate * Error * Gradient * Input
            const penalty = -learningRate * error * gradient * f.value;
            await updateWeight(accountId, f.feature, penalty);
            console.log(`[Backprop] Weight '${f.feature}' for Account ${accountId} changed by ${penalty.toFixed(4)}. (Sigmoid Score was ${(score*100).toFixed(1)}%)`);
        }

        // Adjust bias as well
        const biasPenalty = -learningRate * error * gradient * 1.0;
        await updateWeight(accountId, 'bias', biasPenalty);
        console.log(`[Backprop] Bias for Account ${accountId} changed by ${biasPenalty.toFixed(4)}`);

        // Delete from features and history
        await dbRun('DELETE FROM recommendation_features WHERE history_id = ?', [id]);
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
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
  });
}

module.exports = app;
