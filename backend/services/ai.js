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
  
  if (!openRouterKey) {
    throw new Error('OpenRouter API key is not set.');
  }

  // 1. Gather recent listens
  const recentListens = await getAllRecentListens();
  const dislikes = await dbAll('SELECT name, artist FROM dislikes');
  const pastRecommendations = await dbAll('SELECT title, artist FROM history ORDER BY recommended_at DESC LIMIT 100');

  const recentStr = recentListens.map(r => `${r.artist}-${r.title}`).join(';');
  const dislikeStr = dislikes.map(d => `${d.artist}-${d.name}`).join(';');
  const pastStr = pastRecommendations.map(p => `${p.artist}-${p.title}`).join(';');

  const systemPrompt = `You are a music recommender. You MUST return ONLY a JSON array of ${count} track objects with "title", "artist", and "album" keys. CRITICAL: Do NOT output any markdown, explanations, or conversational text. Output ONLY the raw JSON array. You have access to tools to search real music databases. USE THEM to find real tracks before suggesting them if you are unsure about exact titles, OR use the get_trending_music tool to see what is currently popular and new! If you are not intimately familiar with the tracks in the user's history, USE the get_track_info tool to look up their genres and release years so you can search for similar music! If the user wants to discover new, smaller underground artists based on their library, USE the discover_similar_artists tool!`;
  let userPrompt = "";
  if (recentListens.length > 0) {
    userPrompt = `
Recent Listens: ${recentStr.substring(0, 500)}
Previously Downloaded: ${pastStr.substring(0, 500)}
Disliked: ${dislikeStr.substring(0, 500)}

Recommend ${count} new tracks whose style is a mix of the 'Recent Listens' and 'Previously Downloaded' tracks. 
CRITICAL: You must STRICTLY EXCLUDE the exact tracks listed in 'Disliked' and 'Previously Downloaded'. 
Mix in some brand new/trending tracks if they fit the user's taste!
`;
  } else {
    userPrompt = `
Previously Downloaded: ${pastStr.substring(0, 500)}
Disliked: ${dislikeStr.substring(0, 500)}

Recommend ${count} new tracks whose style is similar to the 'Previously Downloaded' tracks.
CRITICAL: You must STRICTLY EXCLUDE the exact tracks listed in 'Disliked' and 'Previously Downloaded'. 
Mix in some brand new/trending tracks if they fit the user's taste!
`;
  }

  let messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const tools = [
    {
      type: "function",
      function: {
        name: "search_music_database",
        description: "Search iTunes or Deezer database for artists, genres, or tracks to get real existing track names and albums. Use this to avoid hallucinating tracks when you aren't looking for just the top trending hits.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search term, e.g. an artist name like 'Daft Punk' or a genre."
            },
            provider: {
              type: "string",
              description: "The provider to search on: 'itunes' or 'deezer'. Default is 'itunes'."
            }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_trending_music",
        description: "Get the current top trending and newest tracks globally, by specific genre, or by country. Use this to discover brand new music to recommend.",
        parameters: {
          type: "object",
          properties: {
            genre_id: {
              type: "integer",
              description: "Optional Deezer genre ID. Use 0 for All/Global, 132 for Pop, 116 for Rap/Hip Hop, 152 for Rock, 113 for Dance, 165 for R&B, 85 for Alternative, 106 for Electro, 129 for Jazz, 98 for Classical. Default is 0. Ignored if country is set."
            },
            limit: {
              type: "integer",
              description: "Optional number of tracks to fetch. Default is 15."
            },
            country: {
              type: "string",
              description: "Optional 2-letter country code (e.g., 'HU', 'US', 'GB') to get country-specific trending charts. If provided, genre_id is ignored."
            }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_track_info',
        description: 'Retrieve detailed metadata about a specific music track (e.g., genre, release date) to better understand the user\'s taste before generating recommendations.',
        parameters: {
          type: 'object',
          properties: {
            artist: { type: 'string', description: 'The name of the artist.' },
            title: { type: 'string', description: 'The title of the track.' }
          },
          required: ['artist', 'title']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'discover_similar_artists',
        description: 'Discover underground or smaller artists that are musically similar to a given artist. Useful for finding hidden gems based on the user\'s library.',
        parameters: {
          type: 'object',
          properties: {
            artist: { type: 'string', description: 'The name of the artist you want to find similar artists for.' }
          },
          required: ['artist']
        }
      }
    }
  ];

  let maxIterations = 10;
  let finalContent = null;

  console.log(`Generating ${count} recommendations using model: ${aiModel}...`);

  for (let i = 0; i < maxIterations; i++) {
    try {
      console.log(`[AI Iteration ${i + 1}/${maxIterations}] Waiting for response...`);
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: aiModel,
          messages: messages,
          tools: tools,
          response_format: { type: 'json_object' } // Help some models return JSON natively
        },
        {
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://github.com/bence/auto-music-suggester',
            'X-Title': 'Auto Music Suggester'
          },
          timeout: 20000
        }
      );

      const rawMessage = response.data.choices[0].message;
      const message = {
        role: rawMessage.role,
        content: rawMessage.content || ""
      };
      if (rawMessage.tool_calls) {
        message.tool_calls = rawMessage.tool_calls;
      }
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        // Handle tool calls
        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === 'search_music_database') {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const query = args.query || '';
            const provider = args.provider || 'itunes';
            console.log(`AI called search_music_database with query: ${query}, provider: ${provider}`);
            const searchResults = await searchMusicDatabase(query, provider);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(searchResults) });
          } else if (toolCall.function.name === 'get_trending_music') {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const genreId = args.genre_id !== undefined ? args.genre_id : 0;
            const limit = args.limit !== undefined ? args.limit : 15;
            const country = args.country || null;
            console.log(`AI called get_trending_music with genre_id: ${genreId}, limit: ${limit}, country: ${country}`);
            const trendingResults = await getTrendingMusic(genreId, limit, country);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(trendingResults) });
          } else if (toolCall.function.name === 'get_track_info') {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const artist = args.artist || '';
            const title = args.title || '';
            console.log(`AI called get_track_info with artist: ${artist}, title: ${title}`);
            const infoResults = await getTrackInfo(artist, title);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(infoResults) });
          } else if (toolCall.function.name === 'discover_similar_artists') {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            const artist = args.artist || '';
            console.log(`AI called discover_similar_artists with artist: ${artist}`);
            const similarArtists = await discoverSimilarArtists(artist);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(similarArtists) });
          }
        }
        // Continue loop to send tool results back to AI
      } else {
        // No tool calls. Check if it looks like JSON
        let text = message.content || '';
        let cleanText = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
        
        if (cleanText.startsWith('[') || cleanText.startsWith('{')) {
          try {
            // Attempt to parse and validate right here inside the loop
            let parsed = JSON.parse(cleanText);
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
                throw new Error('Response is not a JSON array of tracks.');
            }
            
            // If we reached here, parsing succeeded
            finalContent = parsed;
            break;
          } catch (parseError) {
            console.log(`AI returned invalid JSON structure: ${parseError.message}. Asking to correct.`);
            messages.push({
              role: 'user',
              content: `Invalid JSON format: ${parseError.message}. You MUST return ONLY a valid JSON array of track objects. Do not wrap it in other fields unless necessary, and do not output markdown or conversational text.`
            });
            continue;
          }
        } else {
          console.log(`AI returned conversational text: "${text.substring(0, 50)}...", asking to correct.`);
          messages.push({
            role: 'user',
            content: 'Invalid response. You MUST return ONLY a JSON array, or use a tool. Do NOT output conversational text, explanations, or acknowledge this message.'
          });
          continue; // Loop again
        }
      }
    } catch (error) {
      console.error('AI Recommendation Error during API call:', error.response ? error.response.data : error.message);
      throw error;
    }
  }

  if (!finalContent) {
    throw new Error('AI failed to generate a final response after maximum iterations.');
  }

  console.log(`Successfully generated ${finalContent.length} recommendations.`);
  return finalContent.slice(0, count);
}

module.exports = {
  generateRecommendations
};
