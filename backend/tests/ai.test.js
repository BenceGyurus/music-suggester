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
});
