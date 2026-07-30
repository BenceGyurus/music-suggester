const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dbAll, getSetting } = require('../database');

/**
 * Generates Subsonic Auth token
 */
function generateSubsonicToken(password, salt) {
  return crypto.createHash('md5').update(password + salt).digest('hex');
}

/**
 * Walk directory recursively and return files with stats
 */
function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory()) {
      walkDir(path.join(dir, file), fileList);
    } else if (file.match(/\.(mp3|flac|m4a|ogg)$/i)) {
      fileList.push({
        path: path.join(dir, file),
        name: file,
        mtime: stat.mtime.getTime()
      });
    }
  }
  return fileList;
}

/**
 * Fallback: Get most recently added files from the local navidrome library
 */
async function getRecentListensFromFiles() {
  const mountPath = await getSetting('navidrome_library_path', '/music');
  if (!fs.existsSync(mountPath)) return [];

  let files = walkDir(mountPath);
  
  // Sort by modification time descending
  files.sort((a, b) => b.mtime - a.mtime);
  
  // Take top 50
  const recentFiles = files.slice(0, 50);
  
  return recentFiles.map(f => {
    // Basic heuristic: Artist - Title.mp3 or inside Artist/Album/Title.mp3
    // We'll just pass the filename (without extension) as title for the AI to guess
    const title = f.name.replace(/\.[^/.]+$/, "");
    return {
      artist: 'Unknown (Local File)',
      album: '',
      title: title
    };
  });
}

/**
 * Fetch recently played tracks for a specific Navidrome account using getPlayQueue
 */
async function getRecentlyPlayedForAccount(account) {
  try {
    let params = { u: account.username, v: '1.16.1', c: 'AutoMusicSuggester', f: 'json' };
    if (account.salt) {
      params.t = generateSubsonicToken(account.password_or_token, account.salt);
      params.s = account.salt;
    } else {
      params.p = account.password_or_token;
    }

    let baseUrl = account.url;
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    const response = await axios.get(`${baseUrl}rest/getPlayQueue`, { params, timeout: 10000 });
    const data = response.data['subsonic-response'];
    if (data.status === 'ok') {
      const tracks = data.playQueue?.entry || [];
      // Take up to 50 tracks from the queue
      const recentTracks = tracks.slice(0, 50);
      return recentTracks.map(t => ({ artist: t.artist, album: t.album, title: t.title }));
    }
    return [];
  } catch (error) {
    console.error(`Failed to fetch from Navidrome ${account.url}:`, error.message);
    return [];
  }
}

/**
 * Fetch most played (frequent) albums for a Navidrome account
 */
async function getFrequentAlbumsForAccount(account) {
  try {
    let params = { u: account.username, v: '1.16.1', c: 'AutoMusicSuggester', f: 'json', type: 'frequent', size: 20 };
    if (account.salt) {
      params.t = generateSubsonicToken(account.password_or_token, account.salt);
      params.s = account.salt;
    } else {
      params.p = account.password_or_token;
    }

    let baseUrl = account.url;
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    const response = await axios.get(`${baseUrl}rest/getAlbumList2`, { params, timeout: 10000 });
    const data = response.data['subsonic-response'];
    if (data.status === 'ok') {
      const albums = data.albumList2?.album || [];
      return albums.map(a => ({ artist: a.artist, album: a.name, title: `Top Album: ${a.name}` }));
    }
    return [];
  } catch (error) {
    console.error(`Failed to fetch frequent albums from Navidrome ${account.url}:`, error.message);
    return [];
  }
}

/**
 * Fetch recently played tracks across all configured Navidrome accounts
 */
async function getAllRecentListens() {
  const accounts = await dbAll('SELECT * FROM navidrome_accounts');
  let allListens = [];

  if (accounts.length === 0) {
    // Fallback to reading file dates
    allListens = await getRecentListensFromFiles();
  } else {
    for (const account of accounts) {
      const listens = await getRecentlyPlayedForAccount(account);
      const frequents = await getFrequentAlbumsForAccount(account);
      allListens.push(...listens);
      allListens.push(...frequents);
    }
    // If API requests failed or yielded 0 tracks, try falling back to files
    if (allListens.length === 0) {
      console.log('Navidrome API yielded 0 tracks (or failed). Falling back to local files...');
      allListens = await getRecentListensFromFiles();
    }
  }

  // Group by artist and title, tracking play count
  const listenMap = new Map();
  
  for (const listen of allListens) {
    const key = `${listen.artist}-${listen.title}`;
    if (!listenMap.has(key)) {
      listenMap.set(key, { ...listen, playCount: 1 });
    } else {
      listenMap.get(key).playCount += 1;
    }
  }

  // Convert to array and sort by playCount (descending)
  const uniqueListens = Array.from(listenMap.values());
  uniqueListens.sort((a, b) => b.playCount - a.playCount);

  // We can trim this to the top 50 to avoid blowing up the prompt context
  const topListens = uniqueListens.slice(0, 50);

  console.log(`Aggregated ${topListens.length} top recent listens from Navidrome/Local files.`);
  return topListens;
}

module.exports = {
  getAllRecentListens
};
