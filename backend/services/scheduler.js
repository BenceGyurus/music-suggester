const cron = require('node-cron');
const { generateRecommendations } = require('./ai');
const { processTrackDownload } = require('./downloader');
const { dbRun, dbGet, dbAll, getSetting } = require('../database');

let isProcessingQueue = false;

async function runRecommendationJob() {
  console.log('Running scheduled recommendation job...');
  try {
    const maxRecsStr = await getSetting('max_recommendations', '5');
    const maxRecs = parseInt(maxRecsStr) || 5;

    const accounts = await dbAll('SELECT * FROM navidrome_accounts');

    let allRecommendations = [];

    if (accounts.length === 0) {
      console.log('No Navidrome accounts found, running global fallback job...');
      const recs = await generateRecommendations(null);
      recs.forEach(r => r._account = null);
      allRecommendations.push(...recs);
    } else {
      for (const account of accounts) {
        console.log(`Running job for account: ${account.username}`);
        const recs = await generateRecommendations(account);
        recs.forEach(r => r._account = account);
        allRecommendations.push(...recs);
      }
    }
    
    // Deduplicate recommendations before saving
    const uniqueRecs = [];
    const seenRecs = new Set();
    for (const r of allRecommendations) {
      const key = `${r.artist}-${r.title}`;
      if (!seenRecs.has(key)) {
        seenRecs.add(key);
        uniqueRecs.push(r);
      }
    }

    for (const rec of uniqueRecs) {
      const title = rec.title || rec.Title || rec.TITLE;
      const artist = rec.artist || rec.Artist || rec.ARTIST;
      const album = rec.album || rec.Album || rec.ALBUM || '';
      const recAccountId = rec._account ? rec._account.id : null;

      if (title && artist) {
        // Check if already in history
        const existing = await dbGet('SELECT id FROM history WHERE title = ? AND artist = ?', [title, artist]);
        if (!existing) {
          // Fetch cover art quickly from iTunes
          let imageUrl = '';
          try {
            const axios = require('axios');
            const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist + ' ' + title)}&entity=song&limit=1`;
            const res = await axios.get(url, { timeout: 5000 });
            if (res.data && res.data.results && res.data.results.length > 0) {
              // Replace 100x100 with 600x600 for better quality
              imageUrl = res.data.results[0].artworkUrl100?.replace('100x100bb', '600x600bb') || '';
            }
          } catch (e) {
            console.error('Failed to fetch cover art for', artist, title);
          }

          const result = await dbRun(
            'INSERT INTO history (account_id, title, artist, album, status, image_url) VALUES (?, ?, ?, ?, ?, ?)',
            [recAccountId, title, artist, album, 'recommended', imageUrl]
          );

          if (rec.features && Array.isArray(rec.features)) {
            const { getWeights } = require('../database');
            const weights = await getWeights(recAccountId || 0);

            for (const featureStr of rec.features) {
              let featureName = featureStr;
              let featureValue = 1.0;
              
              if (featureStr.startsWith('llm_')) {
                const parts = featureStr.split('_');
                featureValue = parseFloat(parts.pop());
                featureName = parts.join('_');
              }
              
              const currentWeight = weights[featureName] || 0;
              await dbRun(
                'INSERT INTO recommendation_features (history_id, feature, value, weight_at_time) VALUES (?, ?, ?, ?)',
                [result.id, featureName, featureValue, currentWeight]
              );
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Scheduled recommendation job failed:', error.message);
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    // Find tracks that were recommended and user hasn't disliked, and are marked as 'queued'
    // Actually, auto-download means we might just queue everything that is 'recommended'.
    // Let's rely on a setting 'auto_download'. If true, 'recommended' -> downloaded.
    // Otherwise, 'recommended' stays until user clicks 'Download' (changes to 'queued').
    
    const autoDownload = await getSetting('auto_download', 'true') === 'true';

    let pendingTracks = [];
    if (autoDownload) {
      pendingTracks = await dbAll("SELECT * FROM history WHERE status IN ('recommended', 'queued') AND hidden = 0 ORDER BY id ASC LIMIT 1");
    } else {
      pendingTracks = await dbAll("SELECT * FROM history WHERE status = 'queued' AND hidden = 0 ORDER BY id ASC LIMIT 1");
    }

    if (pendingTracks.length > 0) {
      const track = pendingTracks[0];
      console.log(`Processing queue for track: ${track.artist} - ${track.title}`);
      
      const result = await processTrackDownload(track.artist, track.title);
      
      if (result.status === 'queued') {
         await dbRun("UPDATE history SET status = 'downloaded', track_id = ?, image_url = ? WHERE id = ?", 
            [result.track.id, result.track.album?.cover_url || '', track.id]);
      } else if (result.status === 'skipped') {
         await dbRun("UPDATE history SET status = 'downloaded' WHERE id = ?", [track.id]);
      } else {
         await dbRun("UPDATE history SET status = 'failed' WHERE id = ?", [track.id]);
      }
    }
  } catch (error) {
    console.error('Queue processing error:', error.message);
  } finally {
    isProcessingQueue = false;
  }
}

function initScheduler() {
  // Run recommendation job daily at midnight
  cron.schedule('0 0 * * *', runRecommendationJob);
  
  // Process download queue every 30 seconds
  cron.schedule('*/30 * * * * *', processQueue);

  console.log('Scheduler initialized.');
}

module.exports = {
  initScheduler,
  runRecommendationJob // export for manual trigger
};
