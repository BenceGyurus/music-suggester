const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getSetting } = require('../database');

/**
 * Normalizes string for comparison (lowercase, removes special chars)
 */
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks the locally mounted Navidrome directory for duplicates.
 * Navidrome usually organizes by Artist/Album/Track.
 * This does a basic check to see if there's a file matching the artist and title.
 */
async function checkLocalDirectory(artist, title) {
  const mountPath = await getSetting('navidrome_library_path', '/music');
  if (!fs.existsSync(mountPath)) {
    return false; // Cannot check local dir
  }

  try {
    const artists = fs.readdirSync(mountPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory());

    const targetArtistNorm = normalizeString(artist);
    const targetTitleNorm = normalizeString(title);

    for (const artistDir of artists) {
      if (normalizeString(artistDir.name) === targetArtistNorm || targetArtistNorm.includes(normalizeString(artistDir.name))) {
        // Found artist folder, let's search inside recursively
        const artistPath = path.join(mountPath, artistDir.name);
        if (searchTitleInDir(artistPath, targetTitleNorm)) {
          return true; // Found duplicate
        }
      }
    }
  } catch (error) {
    console.error('Error reading local directory:', error);
  }
  return false;
}

function searchTitleInDir(dirPath, targetTitleNorm) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (searchTitleInDir(path.join(dirPath, entry.name), targetTitleNorm)) {
        return true;
      }
    } else {
      // It's a file
      if (normalizeString(entry.name).includes(targetTitleNorm)) {
        return true; // Title is in the filename
      }
    }
  }
  return false;
}

/**
 * Find the track using the downloader's /api/search API
 */
async function searchTrackOnDownloader(artist, title) {
  const downloaderUrl = await getSetting('downloader_url');
  if (!downloaderUrl) throw new Error('Downloader URL not set');

  const url = downloaderUrl.endsWith('/') ? downloaderUrl : downloaderUrl + '/';
  
  // Try to determine the configured provider from health check
  let provider = 'deezer';
  try {
    const health = await axios.get(`${url}api/health`, { timeout: 3000 });
    if (health.data && health.data.default_metadata_provider) {
      provider = health.data.default_metadata_provider;
    }
  } catch (e) {
    console.error('Could not fetch downloader health, defaulting to deezer');
  }

  const response = await axios.post(`${url}api/search`, {
    query: `${artist} ${title}`,
    provider: provider,
    limit: 1
  }, { timeout: 10000 });

  if (response.data && response.data.length > 0) {
    // Save the provider we used so queueDownload can use the same one
    const track = response.data[0];
    track._provider = provider;
    return track; // { id, title, artist, album, etc. }
  }
  return null;
}

/**
 * Checks if the track exists via the downloader's API
 */
async function checkDownloaderAPIExists(trackId) {
    const downloaderUrl = await getSetting('downloader_url');
    if (!downloaderUrl) return false;
    const url = downloaderUrl.endsWith('/') ? downloaderUrl : downloaderUrl + '/';
    
    try {
        const response = await axios.get(`${url}api/track/${trackId}/exists`);
        // Assuming response.data.exists is boolean
        return response.data.exists === true;
    } catch(err) {
        console.error('API duplicate check failed', err.message);
        return false;
    }
}

/**
 * Queues the download via Downloader API
 */
async function queueDownload(trackId, provider = 'deezer') {
    const downloaderUrl = await getSetting('downloader_url');
    if (!downloaderUrl) throw new Error('Downloader URL not set');
    const url = downloaderUrl.endsWith('/') ? downloaderUrl : downloaderUrl + '/';
    const mountPath = await getSetting('navidrome_library_path', '/music');

    const response = await axios.post(`${url}api/download`, {
        track_id: trackId,
        location: 'navidrome',
        navidrome_library: mountPath,
        provider: provider,
        format: 'mp3'
    }, { timeout: 10000 });

    return response.data;
}

/**
 * Full flow: search, check duplicates, download
 */
async function processTrackDownload(artist, title) {
    // 1. Check local dir first
    if (await checkLocalDirectory(artist, title)) {
        console.log(`Duplicate found locally for ${artist} - ${title}`);
        return { status: 'skipped', reason: 'local_duplicate' };
    }

    // 2. Search on downloader
    const track = await searchTrackOnDownloader(artist, title);
    if (!track) {
        console.log(`Could not find track on downloader API: ${artist} - ${title}`);
        return { status: 'failed', reason: 'not_found' };
    }

    // 3. Check via API if it exists
    if (await checkDownloaderAPIExists(track.id)) {
        console.log(`Duplicate found via API for ${artist} - ${title}`);
        return { status: 'skipped', reason: 'api_duplicate' };
    }

    // 4. Download
    await queueDownload(track.id, track._provider || 'deezer');
    console.log(`Queued download for ${artist} - ${title}`);
    return { status: 'queued', track };
}

module.exports = {
  processTrackDownload
};
