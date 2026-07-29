const axios = require('axios');
const crypto = require('crypto');
const { dbAll } = require('../database');

/**
 * Generates Subsonic Auth token
 * @param {string} password 
 * @param {string} salt 
 * @returns {string} MD5 hash
 */
function generateSubsonicToken(password, salt) {
  return crypto.createHash('md5').update(password + salt).digest('hex');
}

/**
 * Fetch recently played tracks for a specific Navidrome account
 */
async function getRecentlyPlayedForAccount(account) {
  try {
    let params = {
      u: account.username,
      v: '1.16.1',
      c: 'AutoMusicSuggester',
      f: 'json',
      size: 50 // Get last 50 recently played
    };

    // Subsonic supports both plaintext password or token+salt
    // Usually token auth is better, let's use it if salt is provided, otherwise plaintext
    if (account.salt) {
      params.t = generateSubsonicToken(account.password_or_token, account.salt);
      params.s = account.salt;
    } else {
      params.p = account.password_or_token;
    }

    // Normalize URL
    let baseUrl = account.url;
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }

    const response = await axios.get(`${baseUrl}rest/getRecentlyPlayed`, { params, timeout: 10000 });
    
    const data = response.data['subsonic-response'];
    if (data.status === 'ok') {
      const tracks = data.recentlyPlayed?.track || [];
      return tracks.map(t => ({
        artist: t.artist,
        album: t.album,
        title: t.title
      }));
    } else {
      console.error(`Navidrome API error for ${account.url}:`, data.error);
      return [];
    }
  } catch (error) {
    console.error(`Failed to fetch from Navidrome ${account.url}:`, error.message);
    return [];
  }
}

/**
 * Fetch recently played tracks across all configured Navidrome accounts
 */
async function getAllRecentListens() {
  const accounts = await dbAll('SELECT * FROM navidrome_accounts');
  let allListens = [];

  for (const account of accounts) {
    const listens = await getRecentlyPlayedForAccount(account);
    allListens.push(...listens);
  }

  // Deduplicate by artist + title
  const uniqueListens = [];
  const seen = new Set();
  
  for (const listen of allListens) {
    const key = `${listen.artist}-${listen.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueListens.push(listen);
    }
  }

  return uniqueListens;
}

module.exports = {
  getAllRecentListens
};
