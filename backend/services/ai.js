const axios = require('axios');
const { getSetting, dbAll } = require('../database');
const { getAllRecentListens } = require('./navidrome');

async function searchMusicDatabase(term, provider = 'itunes') {
  const country = await getSetting('itunes_country', 'HU');
  try {
    if (provider === 'deezer') {
      const url = `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=10`;
      const response = await axios.get(url, { timeout: 10000 });
      const results = response.data.data || [];
      return results.map(r => ({
        artist: r.artist.name,
        title: r.title,
        album: r.album.title
      }));
    } else {
      // Default to iTunes
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10&country=${country}`;
      const response = await axios.get(url, { timeout: 10000 });
      const results = response.data.results || [];
      return results.map(r => ({
        artist: r.artistName,
        title: r.trackName,
        album: r.collectionName,
        genre: r.primaryGenreName
      }));
    }
  } catch (error) {
    console.error('Search Database Error:', error.message);
    return [];
  }
}

async function getTrendingMusic(genreId = 0, limit = 15, country = null) {
  try {
    if (country) {
      // Use iTunes RSS for country-specific charts
      const url = `https://itunes.apple.com/${country.toLowerCase()}/rss/topsongs/limit=${limit}/json`;
      const response = await axios.get(url, { timeout: 10000 });
      const entries = response.data.feed.entry || [];
      // Sometimes if limit=1, entry is an object, not array
      const results = Array.isArray(entries) ? entries : [entries];
      return results.map(r => ({
        artist: r['im:artist'] ? r['im:artist'].label : 'Unknown',
        title: r['im:name'] ? r['im:name'].label : 'Unknown',
        album: r['im:collection'] && r['im:collection']['im:name'] ? r['im:collection']['im:name'].label : 'Unknown'
      }));
    } else {
      // Use Deezer for global / genre charts
      const url = `https://api.deezer.com/chart/${genreId}/tracks?limit=${limit}`;
      const response = await axios.get(url, { timeout: 10000 });
      const results = response.data.data || [];
      return results.map(r => ({
        artist: r.artist.name,
        title: r.title,
        album: r.album.title
      }));
    }
  } catch (error) {
    console.error('Trending Chart Error:', error.message);
    return [];
  }
}

/**
 * Fetch detailed metadata about a specific track.
 */
async function getTrackInfo(artist, title) {
  const country = await getSetting('itunes_country', 'HU');
  try {
    const term = `${artist} ${title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1&country=${country}`;
    const response = await axios.get(url, { timeout: 10000 });
    const results = response.data.results || [];
    if (results.length > 0) {
      const r = results[0];
      return {
        artist: r.artistName,
        title: r.trackName,
        album: r.collectionName,
        genre: r.primaryGenreName,
        release_date: r.releaseDate ? r.releaseDate.substring(0, 10) : 'Unknown',
        duration_ms: r.trackTimeMillis
      };
    }
    return { error: "Track not found" };
  } catch (error) {
    console.error('Get Track Info Error:', error.message);
    return { error: "Failed to fetch track info" };
  }
}

/**
 * Fetch detailed metadata and top tracks for a specific artist.
 */
async function getArtistInfo(artistName) {
  try {
    const searchUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
    const searchRes = await axios.get(searchUrl, { timeout: 10000 });
    const artists = searchRes.data.data || [];
    if (artists.length === 0) return { error: "Artist not found" };
    
    const artistId = artists[0].id;
    const topTracksUrl = `https://api.deezer.com/artist/${artistId}/top?limit=5`;
    const topTracksRes = await axios.get(topTracksUrl, { timeout: 10000 });
    
    return {
      name: artists[0].name,
      fans: artists[0].nb_fan,
      top_tracks: (topTracksRes.data.data || []).map(t => t.title)
    };
  } catch (error) {
    console.error('Get Artist Info Error:', error.message);
    return { error: "Failed to fetch artist info" };
  }
}

/**
 * Discover similar but smaller artists based on a known artist.
 */
async function discoverSimilarArtists(artistName) {
  try {
    // 1. Find the artist ID on Deezer
    const searchUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`;
    const searchRes = await axios.get(searchUrl, { timeout: 10000 });
    const artists = searchRes.data.data || [];
    if (artists.length === 0) {
      return { error: "Artist not found in Deezer." };
    }
    const artistId = artists[0].id;

    // 2. Fetch related artists
    const relatedUrl = `https://api.deezer.com/artist/${artistId}/related?limit=20`;
    const relatedRes = await axios.get(relatedUrl, { timeout: 10000 });
    const related = relatedRes.data.data || [];

    // 3. Filter for "smaller" artists (e.g. less than 500k fans)
    const MAX_FANS = 500000;
    const underground = related.filter(a => a.nb_fan < MAX_FANS);

    if (underground.length === 0) {
        // If all related are huge, just take the bottom half sorted by fans
        related.sort((a, b) => a.nb_fan - b.nb_fan);
        const smallest = related.slice(0, 5);
        return smallest.map(a => ({ artist: a.name, fans: a.nb_fan }));
    }

    return underground.map(a => ({ artist: a.name, fans: a.nb_fan })).slice(0, 10);
  } catch (error) {
    console.error('Discover Similar Artists Error:', error.message);
    return { error: "Failed to discover similar artists" };
  }
}

/**
 * Look up genres from iTunes API for a list of tracks.
 * Returns a summary string of top genres.
 */
async function getGenreSummary(tracks) {
  if (!tracks || tracks.length === 0) return 'None';
  
  const genres = {};
  // Take up to 20 tracks to avoid hitting rate limits hard
  const sample = tracks.slice(0, 20);
  
  const country = await getSetting('itunes_country', 'HU');
  for (const track of sample) {
    try {
      const term = encodeURIComponent(`${track.artist} ${track.title}`);
      const response = await axios.get(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1&country=${country}`, { timeout: 3000 });
      if (response.data && response.data.results && response.data.results.length > 0) {
        const genre = response.data.results[0].primaryGenreName;
        if (genre) {
          genres[genre] = (genres[genre] || 0) + 1;
        }
      }
    } catch (e) {
      // Ignore errors for individual tracks
    }
    // Sleep slightly to respect rate limits
    await new Promise(r => setTimeout(r, 200));
  }
  
  const sortedGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]);
  if (sortedGenres.length === 0) return 'None';
  
  return sortedGenres.map(([g, count]) => `${g} (${count} tracks)`).join(', ');
}

/**
 * Summarize top artists based on track frequency
 */
function getArtistSummary(tracks) {
  if (!tracks || tracks.length === 0) return 'None';
  
  const artists = {};
  for (const track of tracks) {
    if (track.artist && track.artist.trim() !== '' && track.artist !== 'Unknown') {
      artists[track.artist] = (artists[track.artist] || 0) + (track.playCount || 1);
    }
  }
  
  const sortedArtists = Object.entries(artists).sort((a, b) => b[1] - a[1]);
  if (sortedArtists.length === 0) return 'None';
  
  // Return top 15 artists
  return sortedArtists.slice(0, 15).map(([a, count]) => `${a} (${count} plays/tracks)`).join(', ');
}

/**
 * Generate AI music recommendations via OpenRouter.
 */
async function generateRecommendations(account = null) {
  const openRouterKey = await getSetting('openrouter_key');
  const aiModel = await getSetting('ai_model', 'google/gemini-2.5-flash'); // fallback to a default model
  const userMood = await getSetting('user_mood', '');
  const diversityLevel = parseInt(await getSetting('diversity_level', '2')) || 2;
  
  if (!openRouterKey) {
    throw new Error('OpenRouter API key is not set.');
  }

  // 1. Gather stats (per account or global)
  const { getStatsForAccount, getAllRecentListens } = require('./navidrome');
  let stats;
  if (account) {
    console.log(`Gathering stats for account: ${account.username}`);
    stats = await getStatsForAccount(account);
  } else {
    stats = await getAllRecentListens();
  }

  const dislikes = await dbAll('SELECT name, artist FROM dislikes');
  const pastRecommendations = await dbAll('SELECT title, artist FROM history ORDER BY recommended_at DESC LIMIT 100');
  
  // Break into smaller context to prevent overwhelming small models
  const smallRecentListens = (stats.recent || []).slice(0, 50);
  const smallStarred = (stats.starred || []).slice(0, 50);
  const smallTop = (stats.topAllTime || []).slice(0, 50);
  const smallDislikes = (dislikes || []).slice(0, 30);
  const smallPastRecs = (pastRecommendations || []).slice(0, 30);

  // Fetch genre and artist summaries
  console.log('Fetching genre summaries for top tracks...');
  const allUserTracks = [...(stats.recent || []), ...(stats.starred || []), ...(stats.topAllTime || [])];
  const topGenreSummary = await getGenreSummary(stats.topAllTime);
  const topArtistSummary = getArtistSummary(allUserTracks);

  // Group dislikes to find blacklisted artists
  const dislikeCounts = {};
  dislikes.forEach(d => {
    dislikeCounts[d.artist] = (dislikeCounts[d.artist] || 0) + 1;
  });
  const blacklistedArtists = Object.keys(dislikeCounts).filter(a => dislikeCounts[a] >= 2);
  const blacklistStr = blacklistedArtists.length > 0 ? blacklistedArtists.join(', ') : 'None';

  const recentStr = smallRecentListens.map(r => `${r.artist}-${r.title} (Plays: ${r.playCount || 1})`).join('; ');
  const starredStr = smallStarred.map(r => `${r.artist}-${r.title}`).join('; ');
  const topStr = smallTop.map(r => `${r.artist}-${r.title}`).join('; ');
  const dislikeStr = smallDislikes.slice(0, 10).map(d => `${d.artist}-${d.name}`).join('; ');
  const pastStr = smallPastRecs.map(p => `${p.artist}-${p.title}`).join('; ');

  // Helper to reliably call AI and parse JSON
  async function callAIWithRetry(sysPrompt, usrPrompt, maxTries = 3, temperature = 0.5) {
    for (let i = 0; i < maxTries; i++) {
      try {
        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: aiModel,
            temperature: temperature,
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: usrPrompt }
            ]
          },
          {
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'HTTP-Referer': 'https://github.com/bence/auto-music-suggester',
              'X-Title': 'Auto Music Suggester'
            },
            timeout: 30000
          }
        );
        
        if (!response.data || !response.data.choices || response.data.choices.length === 0) {
          const errorMsg = response.data?.error ? JSON.stringify(response.data.error) : 'Unknown OpenRouter Error';
          throw new Error(`OpenRouter API returned an invalid response: ${errorMsg}`);
        }

        let text = response.data.choices[0].message?.content || '';
        if (!text) {
          throw new Error('OpenRouter API returned an empty message content.');
        }

        let cleanText = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
        
        // Find the first `{` or `[` to parse JSON
        const objStart = cleanText.indexOf('{');
        const arrStart = cleanText.indexOf('[');
        let startIndex = -1;
        if (objStart !== -1 && arrStart !== -1) {
          startIndex = Math.min(objStart, arrStart);
        } else {
          startIndex = Math.max(objStart, arrStart);
        }

        if (startIndex !== -1) {
          cleanText = cleanText.substring(startIndex);
        }

        return JSON.parse(cleanText);
      } catch (err) {
        const axError = err.response?.data?.error ? JSON.stringify(err.response.data.error) : err.message;
        console.error(`AI call failed (attempt ${i+1}):`, axError);
        if (i === maxTries - 1) throw err;
      }
    }
  }

  // --- PHASE 1: Profiling and Research Strategy ---
  console.log(`[Phase 1] Analyzing profile using ${aiModel}...`);
  
  // Diversity-dependent prompt instruction
  let diversityInstruction;
  if (diversityLevel === 1) {
    diversityInstruction = 'CRITICAL: You must STRICTLY limit your searches to the user\'s favorite artists and genres. Recommend tracks ONLY from artists they already listen to. Do NOT explore outside their existing taste.';
  } else if (diversityLevel === 3) {
    diversityInstruction = 'CRITICAL: You are in DISCOVERY MODE. You must actively explore completely NEW artists, edge genres, and wildcards that the user has NEVER listened to but might enjoy based on their taste. Output EXTREMELY diverse commands. Each command MUST target a DIFFERENT artist or genre. Do NOT recommend any artist the user already listens to.';
  } else {
    diversityInstruction = 'CRITICAL: You must ensure ARTIST DIVERSITY. If outputting multiple commands, target DIFFERENT artists. Do not fixate on a single artist, but stay within their general genre preferences.';
  }

  const researchSystemPrompt = `You are a professional Music Researcher and Data Gatherer. Your job is to analyze the user's music history and decide what external searches you need to run to find good recommendations.
You MUST output ONLY a raw JSON object with a "commands" array. Do not output conversational text.
${diversityInstruction}
Allowed actions:
- "search": Search a general query (e.g. a genre, mood, or song title). Requires "query" field. Do NOT use this for finding an artist's tracks.
- "search_artist_tracks": Search for tracks specifically by a given artist. Requires "artist" field. Use this when you want to recommend songs from a specific artist.
- "similar": Find artists similar to a given artist. Requires "artist" field.
- "trending": Get trending music. Requires "genre_id" field (0=Global, 132=Pop, 116=Rap, 152=Rock, 113=Dance, 165=R&B, 106=Electro, 129=Jazz).
- "analyze_artist": Get genres and top tracks for a specific artist. Requires "artist" field.

Example Output:
{
  "commands": [
    { "action": "analyze_artist", "artist": "Daft Punk" },
    { "action": "search_artist_tracks", "artist": "Queen" },
    { "action": "similar", "artist": "Daft Punk" },
    { "action": "search", "query": "French House" },
    { "action": "trending", "genre_id": 106 }
  ]
}`;

  let historyContext = `
RECENTLY PLAYED: ${recentStr}
STARRED/FAVORITE TRACKS: ${starredStr}
TOP ALL-TIME TRACKS: ${topStr}
TOP GENRES (Based on iTunes Analysis): ${topGenreSummary}
TOP ARTISTS (Overall summary): ${topArtistSummary}
DISLIKED TRACKS (Do NOT recommend these or similar): ${dislikeStr}
BLACKLISTED ARTISTS (NEVER recommend these): ${blacklistStr}
PREVIOUSLY RECOMMENDED: ${pastStr}
USER MOOD / CUSTOM INSTRUCTIONS: ${userMood}
`;

  let commands = [];
  try {
    const phase1Result = await callAIWithRetry(researchSystemPrompt, `Based on this history, what should we search for? Max 3 commands.\n\n${historyContext}`);
    commands = phase1Result.commands || [];
  } catch (err) {
    console.error('Phase 1 failed, proceeding with default trending search.', err.message);
    commands = [{ action: 'trending', genre_id: 0 }];
  }

  // --- PHASE 2: Execution (Candidate Generation) ---
  console.log(`[Phase 2] Executing ${commands.length} research commands...`);
  const candidateMap = new Map(); // artist-title -> track object

  const addCandidate = (track, feature) => {
    if (!track.title || !track.artist) return;
    const key = `${track.artist}-${track.title}`;
    if (!candidateMap.has(key)) {
      candidateMap.set(key, { ...track, features: [feature] });
    } else {
      const existing = candidateMap.get(key);
      if (!existing.features.includes(feature)) {
        existing.features.push(feature);
      }
    }
  };

  let researchContext = ""; // Still keep some context for the LLM

  for (const cmd of commands) {
    try {
      if (cmd.action === 'search' && cmd.query) {
        console.log(`Executing search for: ${cmd.query}`);
        const res = await searchMusicDatabase(cmd.query, 'itunes');
        res.slice(0, 10).forEach(t => addCandidate(t, 'source_search'));
      } else if (cmd.action === 'search_artist_tracks' && cmd.artist) {
        console.log(`Executing search_artist_tracks for: ${cmd.artist}`);
        const country = await getSetting('itunes_country', 'HU');
        
        const { getVerifiedArtist } = require('./artistVerifier');
        const verified = await getVerifiedArtist(cmd.artist, allUserTracks);
        
        let url;
        if (verified && verified.itunes_id) {
          console.log(`[Phase 2] Using VERIFIED iTunes ID for ${cmd.artist}: ${verified.itunes_id}`);
          url = `https://itunes.apple.com/lookup?id=${verified.itunes_id}&entity=song&limit=50&country=${country}`;
        } else {
          url = `https://itunes.apple.com/search?term=${encodeURIComponent(cmd.artist)}&entity=song&attribute=allArtistTerm&limit=50&country=${country}`;
        }
        
        const response = await axios.get(url, { timeout: 10000 });
        const results = (response.data.results || []).filter(r => r.wrapperType === 'track');
        const mapped = results.map(r => ({
          artist: r.artistName,
          title: r.trackName,
          album: r.collectionName,
          genre: r.primaryGenreName
        }));
        
        if (verified && verified.itunes_id) {
          // If verified, we can trust all tracks returned by the lookup
          mapped.slice(0, 15).forEach(t => addCandidate(t, 'source_artist_search'));
        } else {
          // Strict fallback filtering
          const targetArtistLow = cmd.artist.toLowerCase();
          const filtered = mapped.filter(t => t.artist && t.artist.toLowerCase().includes(targetArtistLow));
          filtered.slice(0, 15).forEach(t => addCandidate(t, 'source_artist_search'));
        }
      } else if (cmd.action === 'analyze_artist' && cmd.artist) {
        console.log(`Executing analyze_artist for: ${cmd.artist}`);
        const res = await getArtistInfo(cmd.artist);
        researchContext += `Artist Info for '${cmd.artist}': ${JSON.stringify(res)}\n`;
        // Top tracks from analyze_artist aren't full track objects easily, so we skip adding to candidates directly
      } else if (cmd.action === 'similar' && cmd.artist) {
        console.log(`Executing similar artists for: ${cmd.artist}`);
        const res = await discoverSimilarArtists(cmd.artist);
        researchContext += `Artists similar to '${cmd.artist}': ${JSON.stringify(res.slice(0, 5))}\n`;
        // To get tracks, we'd need to search for these similar artists. 
        // For now, let's just use them as context, OR search for the top 1 similar artist's tracks.
        if (res.length > 0) {
           const topSimilar = await searchMusicDatabase(res[0].artist, 'itunes');
           topSimilar.slice(0, 5).forEach(t => addCandidate(t, 'source_similar'));
        }
      } else if (cmd.action === 'trending') {
        const gid = cmd.genre_id || 0;
        console.log(`Executing trending for genre: ${gid}`);
        const res = await getTrendingMusic(gid, 10, null);
        res.slice(0, 10).forEach(t => addCandidate(t, 'source_trending'));
      }
    } catch (e) {
      console.error(`Command ${cmd.action} failed:`, e.message);
    }
  }

  const rawCandidates = Array.from(candidateMap.values());
  const { isAlreadyDownloaded } = require('./fileSearch');
  const candidates = [];
  
  // Filter out candidates already downloaded
  for (const c of rawCandidates) {
    const isDownloaded = await isAlreadyDownloaded(c.artist, c.title);
    if (!isDownloaded) {
      candidates.push(c);
    } else {
      console.log(`[FileSearch] Skipped candidate '${c.title}' by '${c.artist}' (Already downloaded).`);
    }
  }

  if (candidates.length === 0) {
    throw new Error('No candidate tracks found during Phase 2 (all candidates were already downloaded).');
  }

  // --- PHASE 3: LLM Feature Extraction & Mathematical Scoring ---
  console.log(`[Phase 3] Scoring ${candidates.length} candidates using LLM and Weights...`);
  
  const generationSystemPrompt = `You are a professional Music Evaluator.
Your job is to rate a provided list of candidate tracks based on the User's Profile (history, dislikes, and explicit instructions/mood).
For EACH track in the list, you must provide two scores from 0 to 10:
- "mood_match": How well does it fit the user's explicitly requested mood? (0 if unknown/no match, 10 if perfect)
- "profile_match": How well does it fit their general listening history? (0 if completely opposite, 10 if perfect match)

Output MUST be ONLY a raw JSON array of objects mapping the EXACT title and artist to their scores.
Format:
[
  { "title": "Track Name", "artist": "Artist Name", "mood_match": 8, "profile_match": 9 }
]`;

  const candidateString = candidates.map(c => `- ${c.artist} - ${c.title} (Genre: ${c.genre})`).join('\n');

  const generationUserPrompt = `
USER PROFILE / HISTORY:
${historyContext}
ADDITIONAL RESEARCH CONTEXT:
${researchContext}

CANDIDATES TO RATE:
${candidateString}

Rate ALL candidates above. 
CRITICAL: You must strictly output the JSON array. Do not invent tracks. Only rate the ones listed.
IMPORTANT VERIFICATION: Check the "Genre" of each candidate track! If the artist name matches the user's favorite artist, but the genre is completely different (e.g. user likes Hungarian Rap, but candidate is Lo-Fi or Indian Classical), this means it is a DIFFERENT artist with the same name. Score it 0!`;

  const tempSetting = await getSetting('llm_temperature', '0.2');
  // Override temperature based on diversity level
  let tempPhase3;
  if (diversityLevel === 1) {
    tempPhase3 = 0.1;
  } else if (diversityLevel === 3) {
    tempPhase3 = 0.9;
  } else {
    tempPhase3 = parseFloat(tempSetting) || 0.5;
  }

  let llmScores = [];
  try {
    const finalResult = await callAIWithRetry(generationSystemPrompt, generationUserPrompt, 3, tempPhase3);
    
    let parsed = finalResult;
    if (!Array.isArray(parsed) && parsed.tracks) parsed = parsed.tracks;
    else if (!Array.isArray(parsed)) {
      for (const key in parsed) {
        if (Array.isArray(parsed[key])) {
            parsed = parsed[key];
            break;
        }
      }
    }
    
    if (Array.isArray(parsed)) {
      llmScores = parsed;
    }
  } catch (err) {
    console.error('Phase 3 LLM scoring failed:', err.message);
    // If LLM fails, we will still use the mathematical weights (LLM scores will default to 0)
  }

  // Fetch weights
  const { getWeights } = require('../database');
  const weights = await getWeights(account?.id || 0);
  const minSetting = await getSetting('min_download_score', '0.75');
  let minScoreThreshold = parseFloat(minSetting);

  // Calculate final scores
  for (const track of candidates) {
    let sum = weights['bias'] || 0.0; // Default neutral bias
    
    // Dynamically inject deep profile features
    const isFavorite = (stats.starred || []).some(fav => fav.artist.toLowerCase() === track.artist.toLowerCase());
    if (isFavorite && !track.features.includes('source_favorite_artist')) {
      track.features.push('source_favorite_artist');
    }

    const isTop = (stats.topAllTime || []).some(top => top.artist.toLowerCase() === track.artist.toLowerCase());
    if (isTop && !track.features.includes('source_top_artist')) {
      track.features.push('source_top_artist');
    }

    // 1. Source Features (Binary 1.0)
    for (const feature of track.features) {
      sum += (weights[feature] || 0);
    }
    
    // 2. LLM Features (Normalized from 0-10 to 0.0-1.0)
    const llmRating = llmScores.find(s => s.title === track.title && s.artist === track.artist) || { mood_match: 0, profile_match: 0 };
    const moodVal = (parseFloat(llmRating.mood_match) || 0) / 10.0;
    const profileVal = (parseFloat(llmRating.profile_match) || 0) / 10.0;
    
    // Record feature values for backprop
    track.features.push(`llm_mood_match_${moodVal}`);
    track.features.push(`llm_profile_match_${profileVal}`);
    
    sum += (moodVal * (weights['llm_mood_match'] || 0));
    sum += (profileVal * (weights['llm_profile_match'] || 0));

    // Sigmoid Activation Function
    const probability = 1 / (1 + Math.exp(-sum));
    track.finalScore = probability;
  }

  // Sort by highest score first
  candidates.sort((a, b) => b.finalScore - a.finalScore);

  // Dynamic Threshold Logic
  const hardFloor = 0.50; // 50% confidence minimum
  if (candidates.length > 0 && candidates[0].finalScore < minScoreThreshold && candidates[0].finalScore >= hardFloor) {
    console.log(`Best track score (${(candidates[0].finalScore * 100).toFixed(1)}%) is below threshold (${(minScoreThreshold * 100).toFixed(1)}%). Dynamically lowering threshold.`);
    minScoreThreshold = candidates[0].finalScore - 0.001; // slightly below to ensure floating point math passes
  }

  const finalTracks = [];
  for (const track of candidates) {
    if (track.finalScore >= minScoreThreshold) {
      finalTracks.push(track);
    }
  }

  // Sort by highest score
  finalTracks.sort((a, b) => b.finalScore - a.finalScore);

  console.log(`Successfully scored tracks. ${finalTracks.length} tracks met the threshold of ${minScoreThreshold}.`);
  return finalTracks;
}

module.exports = {
  generateRecommendations
};
