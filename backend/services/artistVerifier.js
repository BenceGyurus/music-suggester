const axios = require('axios');
const { dbGet, dbRun, getSetting } = require('../database');

/**
 * Ensures an artist is locally verified by finding their exact iTunes Artist ID.
 * It uses the user's local track history as an anchor for the search.
 * 
 * @param {string} artistName The artist to verify
 * @param {Array} userTracks The user's listening history (recent, starred, top)
 * @returns {Object|null} Verified artist object { itunes_id, genre } or null
 */
async function getVerifiedArtist(artistName, userTracks = []) {
  if (!artistName) return null;

  // 1. Check local cache first (case insensitive)
  const cached = await dbGet('SELECT * FROM verified_artists WHERE LOWER(name) = LOWER(?)', [artistName]);
  if (cached && cached.itunes_id) {
    return cached;
  }

  // 2. Not in cache. Attempt auto-verification using local tracks.
  const targetArtistLow = artistName.toLowerCase();
  
  // Find a track in the user's history by this exact artist
  const anchorTrack = userTracks.find(t => t.artist && t.artist.toLowerCase() === targetArtistLow && t.title);

  if (anchorTrack) {
    console.log(`[ArtistVerifier] Auto-verifying '${artistName}' using anchor track '${anchorTrack.title}'...`);
    const country = await getSetting('itunes_country', 'HU');
    const term = `${anchorTrack.artist} ${anchorTrack.title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=3&country=${country}`;
    
    try {
      const response = await axios.get(url, { timeout: 5000 });
      const results = response.data.results || [];
      
      // Find the first result where artist name matches strictly
      const match = results.find(r => r.artistName && r.artistName.toLowerCase().includes(targetArtistLow));
      
      if (match && match.artistId) {
        const itunesId = match.artistId.toString();
        const genre = match.primaryGenreName || '';
        
        // Save to DB
        await dbRun('INSERT INTO verified_artists (name, itunes_id, genre) VALUES (?, ?, ?)', [artistName, itunesId, genre]);
        console.log(`[ArtistVerifier] Successfully verified '${artistName}' -> iTunes ID: ${itunesId}`);
        
        return { itunes_id: itunesId, genre: genre };
      } else {
         console.log(`[ArtistVerifier] Failed to verify '${artistName}' - no iTunes match for anchor track.`);
      }
    } catch (err) {
      console.error(`[ArtistVerifier] Error verifying '${artistName}':`, err.message);
    }
  } else {
      console.log(`[ArtistVerifier] Cannot verify '${artistName}' - no anchor track found in user history.`);
  }

  return null;
}

module.exports = { getVerifiedArtist };
