const axios = require('axios');
const { getSetting, dbAll } = require('../database');
const { getAllRecentListens } = require('./navidrome');

async function searchITunes(term) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10`;
    const response = await axios.get(url, { timeout: 10000 });
    const results = response.data.results || [];
    return results.map(r => ({
      artist: r.artistName,
      title: r.trackName,
      album: r.collectionName,
      genre: r.primaryGenreName
    }));
  } catch (error) {
    console.error('iTunes Search Error:', error.message);
    return [];
  }
}

async function getTrendingMusic() {
  try {
    const url = 'https://api.deezer.com/chart/0/tracks';
    const response = await axios.get(url, { timeout: 10000 });
    const results = response.data.data || [];
    return results.slice(0, 15).map(r => ({
      artist: r.artist.name,
      title: r.title,
      album: r.album.title
    }));
  } catch (error) {
    console.error('Deezer Chart Error:', error.message);
    return [];
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

  const systemPrompt = `You are a music recommender. You MUST return ONLY a JSON array of ${count} track objects with "title", "artist", and "album" keys. No markdown, no explanations, just valid JSON array. You have access to tools to search real music databases. USE THEM to find real tracks before suggesting them if you are unsure about exact titles, OR use the get_trending_music tool to see what is currently popular and new!`;
  const userPrompt = `
Recent: ${recentStr.substring(0, 500)}
Disliked: ${dislikeStr.substring(0, 500)}
Past: ${pastStr.substring(0, 500)}

Recommend ${count} new tracks similar to Recent but exclude Disliked and Past. Mix in some brand new/trending tracks if they fit the user's taste!
`;

  let messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const tools = [
    {
      type: "function",
      function: {
        name: "search_music_database",
        description: "Search iTunes database for artists or genres to get real existing track names and albums. Use this to avoid hallucinating tracks.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search term, e.g. an artist name like 'Daft Punk' or a genre."
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
        description: "Get the current top trending and newest tracks globally. Use this to discover brand new music to recommend.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }
    }
  ];

  let maxIterations = 3;
  let finalContent = null;

  for (let i = 0; i < maxIterations; i++) {
    try {
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

      const message = response.data.choices[0].message;
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        // Handle tool calls
        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === 'search_music_database') {
            const args = JSON.parse(toolCall.function.arguments || '{}');
            console.log(`AI called search_music_database with query: ${args.query}`);
            const searchResults = await searchITunes(args.query);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(searchResults) });
          } else if (toolCall.function.name === 'get_trending_music') {
            console.log(`AI called get_trending_music`);
            const trendingResults = await getTrendingMusic();
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(trendingResults) });
          }
        }
        // Continue loop to send tool results back to AI
      } else {
        // No tool calls, AI provided the final response
        finalContent = message.content;
        break;
      }
    } catch (error) {
      console.error('AI Recommendation Error during API call:', error.response ? error.response.data : error.message);
      throw error;
    }
  }

  if (!finalContent) {
    throw new Error('AI failed to generate a final response after maximum iterations.');
  }

  // Clean markdown if present
  let content = finalContent.replace(/```json/g, '').replace(/```/g, '').trim();
  
  // Some models wrap the array in an object if response_format is used
  let parsed = JSON.parse(content);
  if (!Array.isArray(parsed) && parsed.tracks) {
      parsed = parsed.tracks;
  } else if (!Array.isArray(parsed)) {
      // Find the first array in values
      for (const key in parsed) {
          if (Array.isArray(parsed[key])) {
              parsed = parsed[key];
              break;
          }
      }
  }
  
  if (!Array.isArray(parsed)) {
      throw new Error('AI response could not be parsed as an array of tracks');
  }

  return parsed.slice(0, count);
}

module.exports = {
  generateRecommendations
};
