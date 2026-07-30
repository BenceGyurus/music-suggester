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

  it('should generate recommendations via 3-phase workflow', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([{ artist: 'Artist A', title: 'Song A' }]);
    dbAll.mockResolvedValue([]); // No dislikes or history

    // Phase 1 Mock (Research Commands)
    const phase1Response = {
      commands: [
        { action: 'search', query: 'Daft Punk' }
      ]
    };

    // Phase 3 Mock (Final Generation)
    const phase3Response = {
      tracks: [
        { title: 'Get Lucky', artist: 'Daft Punk', album: 'RAM' }
      ]
    };

    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(phase1Response) } }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(phase3Response) } }] } });

    // Phase 2 Mock (iTunes API)
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
    expect(axios.post).toHaveBeenCalledTimes(2); // Phase 1 & Phase 3
    expect(axios.get).toHaveBeenCalledTimes(1); // iTunes search
  });

  it('should handle similar artist commands in Phase 2', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    const phase1Response = {
      commands: [
        { action: 'similar', artist: 'Daft Punk' }
      ]
    };

    const phase3Response = {
      tracks: [
        { title: 'Underground Track', artist: 'Underground Artist', album: 'Album' }
      ]
    };

    axios.post
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(phase1Response) } }] } })
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(phase3Response) } }] } });

    // Mock Deezer search artist
    axios.get.mockResolvedValueOnce({
      data: { data: [{ id: 27, name: 'Daft Punk' }] }
    });

    // Mock Deezer related artists
    axios.get.mockResolvedValueOnce({
      data: {
        data: [
          { name: 'Underground Artist', nb_fan: 1000 },
          { name: 'Mainstream Artist', nb_fan: 1000000 }
        ]
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Underground Track');
    
    // 2 GET requests: one for finding artist ID, one for finding similar artists
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenCalledWith('https://api.deezer.com/search/artist?q=Daft%20Punk&limit=1', expect.any(Object));
  });

  it('should gracefully fallback if Phase 1 fails', async () => {
    getSetting.mockImplementation((key) => {
      if (key === 'openrouter_key') return 'test_key';
      if (key === 'ai_model') return 'test_model';
      return null;
    });

    getAllRecentListens.mockResolvedValue([]);
    dbAll.mockResolvedValue([]);

    let callCount = 0;
    axios.post.mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        // Phase 1 attempts (fail 3 times)
        return Promise.resolve({ data: { choices: [{ message: { content: 'This is not json' } }] } });
      } else {
        // Phase 3 attempt
        const phase3Response = {
          tracks: [
            { title: 'Fallback Track', artist: 'Fallback', album: 'Album' }
          ]
        };
        return Promise.resolve({ data: { choices: [{ message: { content: JSON.stringify(phase3Response) } }] } });
      }
    });

    // Since Phase 1 fails, it defaults to trending command
    axios.get.mockResolvedValueOnce({
      data: {
        data: [
          { artist: { name: 'Pop Star' }, title: 'New Hit', album: { title: 'The Album' } }
        ]
      }
    });

    const recs = await generateRecommendations(1);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe('Fallback Track');
    expect(axios.get).toHaveBeenCalledWith('https://api.deezer.com/chart/0/tracks?limit=5', expect.any(Object)); // Default trending search
  });
});
