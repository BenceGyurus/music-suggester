const axios = require('axios');
const { generateRecommendations } = require('../services/ai');
const { getAllRecentListens } = require('../services/navidrome');
const { getSetting, dbAll } = require('../database');

jest.mock('axios');
jest.mock('../services/navidrome');
jest.mock('../database', () => ({
  getSetting: jest.fn(),
  dbAll: jest.fn()
}));

describe('AI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error if OpenRouter key is not set', async () => {
    getSetting.mockResolvedValueOnce(null); // No API key
    await expect(generateRecommendations(5)).rejects.toThrow('OpenRouter API key is not set.');
  });

  it('should generate recommendations and parse JSON', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([{ artist: 'Artist A', title: 'Song A' }]);
    dbAll.mockResolvedValue([]); // No dislikes or history

    const mockAiResponse = [
      { title: 'Rec 1', artist: 'Art 1', album: 'Alb 1' },
      { title: 'Rec 2', artist: 'Art 2', album: 'Alb 2' }
    ];

    axios.post.mockResolvedValue({
      data: {
        choices: [
          { message: { content: JSON.stringify(mockAiResponse) } }
        ]
      }
    });

    const recs = await generateRecommendations(2);
    expect(recs.length).toBe(2);
    expect(recs[0].title).toBe('Rec 1');
    expect(axios.post).toHaveBeenCalledTimes(1);
    
    // Check prompt building
    const callArgs = axios.post.mock.calls[0];
    expect(callArgs[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(callArgs[1].model).toBe('test_model');
    expect(callArgs[1].messages[1].content).toContain('Artist A-Song A'); // Recent string
  });
  
  it('should handle nested tracks object in AI response', async () => {
    getSetting.mockResolvedValue('test_key');
    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    const mockAiResponse = {
        tracks: [
            { title: 'Rec 1', artist: 'Art 1', album: 'Alb 1' }
        ]
    };

    axios.post.mockResolvedValue({
      data: {
        choices: [
          { message: { content: JSON.stringify(mockAiResponse) } }
        ]
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Rec 1');
  });

  it('should handle tool calls for iTunes search', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    const toolCallMessage = {
      tool_calls: [
        {
          id: 'call_123',
          function: {
            name: 'search_music_database',
            arguments: JSON.stringify({ query: 'Daft Punk' })
          }
        }
      ]
    };

    const mockAiResponse = [
      { title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories' }
    ];

    const finalMessage = {
      content: JSON.stringify(mockAiResponse)
    };

    // First call returns a tool call, second call returns the final JSON
    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: toolCallMessage }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: finalMessage }] } });

    // Mock iTunes GET request
    axios.get.mockResolvedValueOnce({
      data: {
        results: [
          { artistName: 'Daft Punk', trackName: 'Get Lucky', collectionName: 'RAM', primaryGenreName: 'Electronic' }
        ]
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Get Lucky');
    expect(axios.post).toHaveBeenCalledTimes(2); // Initial + tool result
    expect(axios.get).toHaveBeenCalledTimes(1); // iTunes search
  });

  it('should handle search_music_database tool calls for Deezer provider', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    const toolCallMessage = {
      tool_calls: [
        {
          id: 'call_999',
          function: {
            name: 'search_music_database',
            arguments: JSON.stringify({ query: 'The Weeknd', provider: 'deezer' })
          }
        }
      ]
    };

    const mockAiResponse = [
      { title: 'Starboy', artist: 'The Weeknd', album: 'Starboy' }
    ];

    const finalMessage = {
      content: JSON.stringify(mockAiResponse)
    };

    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: toolCallMessage }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: finalMessage }] } });

    // Mock Deezer GET request
    axios.get.mockResolvedValueOnce({
      data: {
        data: [
          { artist: { name: 'The Weeknd' }, title: 'Starboy', album: { title: 'Starboy' } }
        ]
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Starboy');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('api.deezer.com/search?q=The%20Weeknd'), expect.any(Object));
  });

  it('should handle tool calls for Deezer trending music', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    const toolCallMessage = {
      tool_calls: [
        {
          id: 'call_456',
          function: {
            name: 'get_trending_music',
            arguments: JSON.stringify({ genre_id: 132, limit: 5 })
          }
        }
      ]
    };

    const mockAiResponse = [
      { title: 'New Hit', artist: 'Pop Star', album: 'The Album' }
    ];

    const finalMessage = {
      content: JSON.stringify(mockAiResponse)
    };

    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: toolCallMessage }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: finalMessage }] } });

    axios.get.mockResolvedValueOnce({
      data: {
        data: [
          { artist: { name: 'Pop Star' }, title: 'New Hit', album: { title: 'The Album' } }
        ]
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('New Hit');
    expect(axios.get).toHaveBeenCalledWith('https://api.deezer.com/chart/132/tracks?limit=5', expect.any(Object));
  });

  it('should handle tool calls for country specific trending music via iTunes RSS', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    const toolCallMessage = {
      tool_calls: [
        {
          id: 'call_789',
          function: {
            name: 'get_trending_music',
            arguments: JSON.stringify({ country: 'HU', limit: 3 })
          }
        }
      ]
    };

    const mockAiResponse = [
      { title: 'Hungarian Hit', artist: 'HU Star', album: 'HU Album' }
    ];

    const finalMessage = {
      content: JSON.stringify(mockAiResponse)
    };

    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: toolCallMessage }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: finalMessage }] } });

    axios.get.mockResolvedValueOnce({
      data: {
        feed: {
          entry: [
            {
              'im:artist': { label: 'HU Star' },
              'im:name': { label: 'Hungarian Hit' },
              'im:collection': { 'im:name': { label: 'HU Album' } }
            }
          ]
        }
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Hungarian Hit');
    expect(axios.get).toHaveBeenCalledWith('https://itunes.apple.com/hu/rss/topsongs/limit=3/json', expect.any(Object));
  });

  it('should handle tool calls for get_track_info', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    const toolCallMessage = {
      tool_calls: [
        {
          id: 'call_info_1',
          function: {
            name: 'get_track_info',
            arguments: JSON.stringify({ artist: 'Daft Punk', title: 'Get Lucky' })
          }
        }
      ]
    };

    const mockAiResponse = [
      { title: 'Similar Track', artist: 'Similar Artist', album: 'Album' }
    ];

    const finalMessage = {
      content: JSON.stringify(mockAiResponse)
    };

    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: toolCallMessage }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: finalMessage }] } });

    axios.get.mockResolvedValueOnce({
      data: {
        results: [
          { artistName: 'Daft Punk', trackName: 'Get Lucky', collectionName: 'RAM', primaryGenreName: 'Electronic', releaseDate: '2013-04-19' }
        ]
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Similar Track');
    expect(axios.get).toHaveBeenCalledWith('https://itunes.apple.com/search?term=Daft%20Punk%20Get%20Lucky&entity=song&limit=1', expect.any(Object));
  });
});
