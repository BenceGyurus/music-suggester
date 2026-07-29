# Auto Music Suggester

An AI-powered application that automatically recommends and downloads music based on your recent listening habits from Navidrome, and intelligently queues downloads without overloading your download server or introducing duplicates.

This tool acts as the "brain" for your music downloading pipeline, automating the discovery of new music you'll love.

## Dependencies

To handle the actual music downloading, this application depends on an external download API. Specifically, it is designed to work out-of-the-box with **[Musikat](https://github.com/soggy8/musikat)** (or any downloader that implements the same API endpoints for `/api/search`, `/api/download`, and `/api/track/{id}/exists`). You will need to have Musikat (or an equivalent service) running alongside this application.

## Features
- **AI Recommendations**: Uses OpenRouter (e.g., Gemini Flash, Claude) to recommend tracks based on what you actually listen to.
- **AI Tool Calling (Zero Hallucinations)**: The AI is equipped with tools to query the **iTunes Search API** to guarantee real track names, and the **Deezer API** to fetch the latest trending music – all completely free and without requiring API keys!
- **Navidrome Integration**: Fetches your recently played tracks across multiple Navidrome accounts using the Subsonic API. (If no account is linked, it automatically looks at the newest files in your library folder!)
- **Duplicate Prevention**: Checks both your local `navidrome_library` directory and the Downloader's API to prevent duplicate downloads.
- **Modern UI**: A sleek, dark-themed, glassmorphism UI for managing recommendations, disliking tracks (which trains the AI to avoid them), and tweaking settings.
- **Smart Queueing**: Slowly processes recommendations in the background to avoid rate limits on your downloader.

## Installation (Docker)

Use the provided `docker-compose.yml` to get started:

```yaml
version: '3.8'

services:
  auto-music-suggester:
    image: ghcr.io/bencegyurus/music-suggester:latest
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
