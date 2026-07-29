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

    // Generate recommendations
    const recommendations = await generateRecommendations(maxRecs);
    
    for (const rec of recommendations) {
      if (rec.title && rec.artist) {
        // Check if already in history
        const existing = await dbGet('SELECT id FROM history WHERE title = ? AND artist = ?', [rec.title, rec.artist]);
        if (!existing) {
          await dbRun(
            'INSERT INTO history (title, artist, album, status) VALUES (?, ?, ?, ?)',
            [rec.title, rec.artist, rec.album || '', 'recommended']
          );
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
      pendingTracks = await dbAll("SELECT * FROM history WHERE status IN ('recommended', 'queued') ORDER BY id ASC LIMIT 1");
    } else {
      pendingTracks = await dbAll("SELECT * FROM history WHERE status = 'queued' ORDER BY id ASC LIMIT 1");
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
