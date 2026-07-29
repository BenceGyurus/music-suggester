# Auto Music Suggester

An AI-powered application that automatically recommends and downloads music based on your recent listening habits from Navidrome, and intelligently queues downloads without overloading your download server or introducing duplicates.

## Features
- **AI Recommendations**: Uses OpenRouter (e.g., Gemini Flash) to recommend tracks.
- **Navidrome Integration**: Fetches your recently played tracks across multiple Navidrome accounts using the Subsonic API.
- **Duplicate Prevention**: Checks both your local `navidrome_library` directory and the Downloader's API to prevent duplicate downloads.
- **Modern UI**: A sleek, dark-themed, glassmorphism UI for managing recommendations and settings.
- **Smart Queueing**: Slowly processes recommendations in the background to avoid rate limits on your downloader.
- **Continuous Delivery**: Fully Dockerized with GitHub Actions for automated GHCR publishing and semantic versioning releases.

## Installation (Docker)

Use the provided `docker-compose.yml`:

```yaml
version: '3.8'

services:
  auto-music-suggester:
    image: ghcr.io/YOUR_GITHUB_USERNAME/auto-music-suggester:latest
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/backend/data
      - /path/to/your/navidrome/music:/music:ro # Read-only mount of your music library
    restart: unless-stopped
```

## Setup
1. Open the UI at `http://localhost:3001`
2. Go to **Settings** and set your **OpenRouter API Key**.
3. Set your **Downloader URL**.
4. Add your **Navidrome Account(s)**.

The background worker will automatically scan your history every 12 hours and process the download queue continuously.
