const axios = require('axios');
const { getSetting, dbAll } = require('../database');
const { getAllRecentListens } = require('./navidrome');

async function searchMusicDatabase(term, provider = 'itunes') {
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
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10`;
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
  try {
    const term = `${artist} ${title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
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
 * Generate AI music recommendations via OpenRouter.
 */
async function generateRecommendations(count = 5) {
  const openRouterKey = await getSetting('openrouter_key');
  const aiModel = await getSetting('ai_model', 'google/gemini-2.5-flash'); // fallback to a default model
  const userMood = await getSetting('user_mood', '');
  
  if (!openRouterKey) {
    throw new Error('OpenRouter API key is not set.');
  }

  // 1. Gather recent listens
  const recentListens = await getAllRecentListens();
  const dislikes = await dbAll('SELECT name, artist FROM dislikes');
  const pastRecommendations = await dbAll('SELECT title, artist FROM history ORDER BY recommended_at DESC LIMIT 100');
  // Break into smaller context to prevent overwhelming small models
  // Limit to 15 recent, 5 frequent, 10 past, 5 dislikes
  const smallRecentListens = recentListens.slice(0, 20); // increased to 20 for better profile
  const smallDislikes = dislikes;
  const smallPastRecs = pastRecommendations.slice(0, 10);

  // Group dislikes to find blacklisted artists
  const dislikeCounts = {};
  dislikes.forEach(d => {
    dislikeCounts[d.artist] = (dislikeCounts[d.artist] || 0) + 1;
  });
  const blacklistedArtists = Object.keys(dislikeCounts).filter(a => dislikeCounts[a] >= 2);
  const blacklistStr = blacklistedArtists.length > 0 ? blacklistedArtists.join(', ') : 'None';

  const recentStr = smallRecentListens.map(r => `${r.artist}-${r.title} (Plays: ${r.playCount || 1})`).join('; ');
  const dislikeStr = smallDislikes.slice(0, 10).map(d => `${d.artist}-${d.name}`).join('; ');
  const pastStr = smallPastRecs.map(p => `${p.artist}-${p.title}`).join('; ');

  // Helper to reliably call AI and parse JSON
  async function callAIWithRetry(sysPrompt, usrPrompt, maxTries = 3) {
    for (let i = 0; i < maxTries; i++) {
      try {
        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: aiModel,
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
          throw new Error('OpenRouter API returned an invalid response.');
        }

        let text = response.data.choices[0].message.content || '';
        let cleanText = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
        
        // Find the first `{` to parse JSON
        const startIndex = cleanText.indexOf('{');
        if (startIndex !== -1) {
          cleanText = cleanText.substring(startIndex);
        }

        return JSON.parse(cleanText);
      } catch (err) {
        console.error(`AI call failed (attempt ${i+1}):`, err.message);
        if (i === maxTries - 1) throw err;
      }
    }
  }

  // --- PHASE 1: Profiling and Research Strategy ---
  console.log(`[Phase 1] Analyzing profile using ${aiModel}...`);
  
  const researchSystemPrompt = `You are a professional Music Researcher and Data Gatherer. Your job is to analyze the user's music history and decide what external searches you need to run to find good recommendations.
You MUST output ONLY a raw JSON object with a "commands" array. Do not output conversational text.
Allowed actions:
- "search": Search a specific query (e.g. artist or genre). Requires "query" field.
- "similar": Find artists similar to a given artist. Requires "artist" field.
- "trending": Get trending music. Requires "genre_id" field (0=Global, 132=Pop, 116=Rap, 152=Rock, 113=Dance, 165=R&B, 106=Electro, 129=Jazz).
- "analyze_artist": Get genres and top tracks for a specific artist. Requires "artist" field.

Example Output:
{
  "commands": [
    { "action": "analyze_artist", "artist": "Daft Punk" },
    { "action": "similar", "artist": "Daft Punk" },
    { "action": "search", "query": "French House" },
    { "action": "trending", "genre_id": 106 }
  ]
}`;

  let historyContext = "";
  if (userMood) {
    historyContext += `\nUSER MOOD / EXPLICIT INSTRUCTIONS (HIGHEST PRIORITY): ${userMood}\n`;
  }
  historyContext += `Blacklisted Artists (DO NOT SEARCH FOR THEM): ${blacklistStr}\n`;
  
  if (smallRecentListens.length > 0) {
    historyContext += `Recent Listens: ${recentStr}\nPreviously Downloaded: ${pastStr}\nDisliked: ${dislikeStr}`;
  } else {
    historyContext += `Previously Downloaded: ${pastStr}\nDisliked: ${dislikeStr}`;
  }

  let commands = [];
  try {
    const phase1Result = await callAIWithRetry(researchSystemPrompt, `Based on this history, what should we search for? Max 3 commands.\n\n${historyContext}`);
    commands = phase1Result.commands || [];
  } catch (err) {
    console.error('Phase 1 failed, proceeding with default trending search.', err.message);
    commands = [{ action: 'trending', genre_id: 0 }];
  }

  // --- PHASE 2: Execution (Data Gathering) ---
  console.log(`[Phase 2] Executing ${commands.length} research commands...`);
  let gatheredData = [];

  for (const cmd of commands.slice(0, 4)) { // max 4 commands to prevent spam
    try {
      if (cmd.action === 'search' && cmd.query) {
        console.log(`Executing search for: ${cmd.query}`);
        const res = await searchMusicDatabase(cmd.query, 'itunes');
        gatheredData.push(`Search results for '${cmd.query}': ${JSON.stringify(res.slice(0, 5))}`);
      } else if (cmd.action === 'analyze_artist' && cmd.artist) {
        console.log(`Executing analyze_artist for: ${cmd.artist}`);
        const res = await getArtistInfo(cmd.artist);
        gatheredData.push(`Artist Info for '${cmd.artist}': ${JSON.stringify(res)}`);
      } else if (cmd.action === 'similar' && cmd.artist) {
        console.log(`Executing similar artists for: ${cmd.artist}`);
        const res = await discoverSimilarArtists(cmd.artist);
        gatheredData.push(`Artists similar to '${cmd.artist}': ${JSON.stringify(res.slice(0, 5))}`);
      } else if (cmd.action === 'trending') {
        const gid = cmd.genre_id || 0;
        console.log(`Executing trending for genre: ${gid}`);
        const res = await getTrendingMusic(gid, 5, null);
        gatheredData.push(`Trending tracks (genre ${gid}): ${JSON.stringify(res.slice(0, 5))}`);
      }
    } catch (e) {
      console.error(`Command ${cmd.action} failed:`, e.message);
    }
  }

  // --- PHASE 3: Final Generation ---
  console.log(`[Phase 3] Generating final ${count} recommendations...`);
  
  const generationSystemPrompt = `You are a professional Music Recommender.
Based on the User's Profile (history, dislikes, and explicit instructions/mood) AND the Research Data provided, generate exactly ${count} music recommendations.
Rules:
1. Do not recommend artists the user has blacklisted or disliked.
2. Ensure tracks match the user's mood if specified.
3. CRITICAL: ONLY recommend real, existing tracks. Do NOT invent or hallucinate song titles. It is highly recommended to select tracks directly from the RESEARCH RESULTS.
4. Output MUST be ONLY a raw JSON array of objects with "title", "artist", and "album" keys. Do not output anything else.
5. You must strictly follow this exact JSON format:
{
  "tracks": [
    { "title": "Track Name", "artist": "Artist Name", "album": "Album Name" },
    { "title": "Track Name 2", "artist": "Artist Name 2", "album": "Album Name 2" }
  ]
}`;

  const generationUserPrompt = `
USER PROFILE / HISTORY:
${historyContext}

RESEARCH RESULTS (Use this to find new recommendations):
${gatheredData.join('\n\n')}

Recommend ${count} REAL tracks based on the profile and research results. 
CRITICAL: Do NOT invent songs! We will verify if they exist.
CRITICAL: You must STRICTLY EXCLUDE the exact tracks listed in 'Disliked' and 'Previously Downloaded'.
Output strictly the JSON object!`;

  let finalTracks = [];
  try {
    const finalResult = await callAIWithRetry(generationSystemPrompt, generationUserPrompt, 5);
    let parsed = finalResult;
    
    if (!Array.isArray(parsed) && parsed.tracks) {
      parsed = parsed.tracks;
    } else if (!Array.isArray(parsed)) {
      for (const key in parsed) {
        if (Array.isArray(parsed[key])) {
            parsed = parsed[key];
            break;
        }
      }
    }
    
    if (!Array.isArray(parsed)) {
      throw new Error('AI did not return a valid tracks array.');
    }
    if (parsed.length === 0) {
      throw new Error('AI returned an empty tracks array.');
    }

    // --- Validation Step: Filter out hallucinations ---
    console.log('Validating generated tracks against iTunes database...');
    const validatedTracks = [];
    for (const track of parsed) {
      if (!track.title || !track.artist) continue;
      
      const validation = await getTrackInfo(track.artist, track.title);
      if (validation && !validation.error) {
        validatedTracks.push({
          title: validation.title,
          artist: validation.artist,
          album: validation.album || track.album
        });
      } else {
        console.warn(`Discarding hallucinated/unverifiable track: ${track.artist} - ${track.title}`);
      }
    }

    if (validatedTracks.length === 0) {
       throw new Error('All generated tracks failed validation (hallucinations).');
    }

    finalTracks = validatedTracks;
  } catch (err) {
    console.error('Phase 3 failed:', err.message);
    throw new Error('Failed to generate real recommendations after multiple attempts.');
  }

  console.log(`Successfully generated and validated ${finalTracks.length} recommendations.`);
  return finalTracks.slice(0, count);
}

module.exports = {
  generateRecommendations
};
