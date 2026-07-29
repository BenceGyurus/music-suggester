const axios = require('axios');
const fs = require('fs');
const { getAllRecentListens } = require('../services/navidrome');
const { dbAll, getSetting } = require('../database');

jest.mock('axios');
jest.mock('fs');
jest.mock('../database', () => ({
  dbAll: jest.fn(),
  getSetting: jest.fn()
}));

describe('Navidrome Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch from files if no accounts exist', async () => {
    dbAll.mockResolvedValue([]); // No accounts
    getSetting.mockResolvedValue('/mock/music');
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockReturnValue(['Song1.mp3', 'Song2.flac']);
    
    // Mock fs.statSync to return mtime
    let callCount = 0;
    fs.statSync.mockImplementation(() => {
      callCount++;
      return {
        isDirectory: () => false,
        mtime: { getTime: () => 1000 + callCount } // Different times
      };
    });

    const listens = await getAllRecentListens();
    
    // Since Song2 is returned second, its mtime is higher, so it should be first
    expect(listens.length).toBe(2);
    expect(listens[0].title).toBe('Song2');
    expect(listens[1].title).toBe('Song1');
  });

  it('should fetch from API if accounts exist', async () => {
    dbAll.mockResolvedValue([
      { url: 'http://navi1', username: 'user1', password_or_token: 'pass' }
    ]);

    axios.get.mockResolvedValue({
      data: {
        'subsonic-response': {
          status: 'ok',
          playQueue: {
            entry: [
              { artist: 'Artist A', title: 'Song A' },
              { artist: 'Artist A', title: 'Song B' }
            ]
          }
        }
      }
    });

    const listens = await getAllRecentListens();
    expect(listens.length).toBe(2);
    expect(listens[0].title).toBe('Song A');
    expect(axios.get).toHaveBeenCalledWith('http://navi1/rest/getPlayQueue', expect.any(Object));
  });

  it('should deduplicate tracks', async () => {
    dbAll.mockResolvedValue([
      { url: 'http://navi1', username: 'user1', password_or_token: 'pass' },
      { url: 'http://navi2', username: 'user2', password_or_token: 'pass' }
    ]);

    axios.get.mockResolvedValue({
      data: {
        'subsonic-response': {
          status: 'ok',
          playQueue: {
            entry: [
              { artist: 'Artist A', title: 'Song A' }
            ]
          }
        }
      }
    }); // Both accounts return the same track

    const listens = await getAllRecentListens();
    
    // Should only have 1 item due to deduplication
    expect(listens.length).toBe(1);
    expect(listens[0].title).toBe('Song A');
  });
});
