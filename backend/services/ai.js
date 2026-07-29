const axios = require('axios');
const { getSetting, dbAll } = require('../database');
const { getAllRecentListens } = require('./navidrome');

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
  
  // 2. Gather dislikes
  const dislikes = await dbAll('SELECT name, artist FROM dislikes');
  
  // 3. Gather previously recommended (so we don't repeat them)
  const pastRecommendations = await dbAll('SELECT title, artist FROM history ORDER BY recommended_at DESC LIMIT 100');

  // Token-saving formatting
  // Instead of long sentences, just compact lists.
  const recentStr = recentListens.map(r => `${r.artist}-${r.title}`).join(';');
  const dislikeStr = dislikes.map(d => `${d.artist}-${d.name}`).join(';');
  const pastStr = pastRecommendations.map(p => `${p.artist}-${p.title}`).join(';');

  const systemPrompt = `You are a music recommender. Return ONLY a JSON array of ${count} track objects with "title", "artist", and "album" keys. No markdown, no explanations, just valid JSON array.`;
  const userPrompt = `
Recent: ${recentStr.substring(0, 500)} // truncate to save tokens if huge
Disliked: ${dislikeStr.substring(0, 500)}
Past: ${pastStr.substring(0, 500)}

Recommend ${count} new tracks similar to Recent but exclude Disliked and Past.
`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: aiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
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

    let content = response.data.choices[0].message.content;
    
    // Clean markdown if present
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    
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
  } catch (error) {
    console.error('AI Recommendation Error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  generateRecommendations
};
