const axios = require('axios');
const { generateRecommendations } = require('../services/ai');
const { getAllRecentListens } = require('../services/navidrome');
const { getSetting, dbAll, getWeights } = require('../database');

jest.mock('axios');
jest.mock('../services/navidrome');
jest.mock('../database', () => ({
  getSetting: jest.fn(),
  dbAll: jest.fn(),
  getWeights: jest.fn()
}));

describe('AI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    getWeights.mockResolvedValue({
      'source_similar': 10,
      'source_trending': 5,
      'source_search': 8,
      'llm_mood_match': 2,
      'llm_profile_match': 1.5
    });

    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      if (key === 'user_mood') return 'chill';
      if (key === 'min_download_score') return '25';
      return null;
    });

    getAllRecentListens.mockResolvedValue([{ artist: 'Artist A', title: 'Song A' }]);
    dbAll.mockResolvedValue([]);
  });

  it('should throw an error if OpenRouter key is not set', async () => {
    getSetting.mockImplementation((key) => {
        if (key === 'openrouter_key') return null;
        return 'test';
    });
    await expect(generateRecommendations()).rejects.toThrow('OpenRouter API key is not set.');
  });

  it('should generate recommendations via 3-phase neural workflow', async () => {
    // Phase 1 Mock
    const phase1Response = {
      commands: [
        { action: 'search', query: 'Daft Punk' }
      ]
    };

    // Phase 3 Mock (Rating)
    const phase3Response = [
        { title: 'Get Lucky', artist: 'Daft Punk', mood_match: 10, profile_match: 10 }
    ];

    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(phase1Response) } }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(phase3Response) } }] } });

    // Phase 2 Mock (iTunes Search)
    axios.get.mockImplementation((url) => {
      if (url.includes('itunes.apple.com/search')) {
        return Promise.resolve({
          data: {
            results: [
              { artistName: 'Daft Punk', trackName: 'Get Lucky', collectionName: 'RAM' },
              { artistName: 'Daft Punk', trackName: 'Bad Song', collectionName: 'RAM' }
            ]
          }
        });
      }
      return Promise.resolve({ data: { results: [] } });
    });

    const recs = await generateRecommendations();
    
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Get Lucky');
    expect(recs[0].finalScore).toBe(43);
    
    expect(axios.post).toHaveBeenCalledTimes(2); // Phase 1 & 3
    expect(axios.get).toHaveBeenCalledTimes(1); // Phase 2 iTunes search
  });

  it('should gracefully fallback if Phase 1 fails', async () => {
    let callCount = 0;
    axios.post.mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        return Promise.resolve({ data: { choices: [{ message: { content: 'This is not json' } }] } });
      } else {
        const phase3Response = [
          { title: 'New Hit', artist: 'Pop Star', mood_match: 10, profile_match: 10 }
        ];
        return Promise.resolve({ data: { choices: [{ message: { content: JSON.stringify(phase3Response) } }] } });
      }
    });

    axios.get.mockImplementation((url) => {
      if (url.includes('chart/0/tracks')) {
          return Promise.resolve({
            data: {
              data: [
                { artist: { name: 'Pop Star' }, title: 'New Hit', album: { title: 'The Album' } }
              ]
            }
          });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const recs = await generateRecommendations();
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('New Hit');
    expect(recs[0].finalScore).toBe(40);
    expect(axios.get).toHaveBeenCalledWith('https://api.deezer.com/chart/0/tracks?limit=10', expect.any(Object));
  });
});
