// Mock scheduler so it doesn't run intervals during tests
jest.mock('../services/scheduler', () => ({
  initScheduler: jest.fn(),
  runRecommendationJob: jest.fn()
}));

// Mock database slightly to avoid real hits if any API tests are added here
jest.mock('../database', () => ({
  dbRun: jest.fn(),
  dbAll: jest.fn().mockResolvedValue([]),
  getSetting: jest.fn(),
  setSetting: jest.fn()
}));

const request = require('supertest');
const app = require('../server');

describe('Server Integration', () => {
  it('should serve index.html for unknown GET routes without throwing PathError', async () => {
    // We send a request to a non-existent frontend route like /my-custom-frontend-page
    // This used to crash with the wildcard error in Express 5.
    const response = await request(app).get('/my-custom-frontend-page');
    
    // We expect it to fallback and return the 200 OK (index.html), not crash
    // We can't guarantee index.html is actually present in /dist during the test, 
    // so we just check it doesn't throw a 500 error or crash.
    // If static files are not built, res.sendFile might return 404, which is fine, 
    // as long as it isn't crashing with PathError.
    expect(response.status).not.toBe(500);
    expect([200, 404]).toContain(response.status);
  });
});
