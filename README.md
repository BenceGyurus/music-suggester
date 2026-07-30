# Auto Music Suggester 🎵🤖

[![Version](https://img.shields.io/badge/version-v2.4.6-blue.svg)](https://github.com/BenceGyurus/music-suggester)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

**Auto Music Suggester** is a self-hosted, AI-powered music recommendation engine. It deeply analyzes your personal music library (via Navidrome/Subsonic APIs), researches the internet for new artists and tracks using Large Language Models (LLMs), and automatically downloads the best matches to a specified directory.

Unlike standard static recommendation engines, this system uses a **Hybrid Neural Scoring Architecture (v2)** with backpropagation to continuously learn from your dislikes and adapt perfectly to your unique taste.

---

## 🌟 Key Features

*   **🧠 Hybrid Neural-AI Architecture**: Combines the creative semantic understanding of LLMs (Gemini, Claude, GPT) with a strict mathematical feature-weighting engine.
*   **🔗 Deep Navidrome Integration**: Syncs seamlessly with Navidrome (Subsonic API) to read your recently played tracks, all-time favorites, and most played albums to build a macro-profile of your taste.
*   **🎓 Reinforcement Learning (Backpropagation)**: Disliking a song dynamically penalizes the specific internal features (e.g., `source_trending`, `llm_mood_match`) that caused the system to recommend it, teaching it exactly *why* you didn't like it.
*   **🛡️ Hallucination Guard**: Generative AI models often hallucinate fake song titles. This system prevents that by forcing the LLM to only evaluate and score real tracks fetched dynamically from iTunes and Deezer APIs.
*   **👥 Multi-User Support**: Fully isolates neural network weights and music histories per user account.
*   **🌍 Artist Diversity Engine**: Strictly enforces an artist quota per recommendation batch so the AI doesn't fixate on a single artist.
*   **🎛️ Explicit Mood Control**: Tell the AI exactly what you want to hear via Custom Instructions (e.g., *"I need fast-paced workout music"* or *"Only Hungarian pop from 2024"*).
*   **🚫 Smart Blacklisting & Local Caching**: Dislike a song and it's instantly hidden and blacklisted from future searches, backed by an optimistic UI layer.
*   **🐳 Docker Ready**: Easily deployable via Docker and Docker Compose.

---

## 🛠️ How it Works

The recommendation engine runs on a schedule (e.g., daily) and executes a 4-phase workflow:

1.  **Context Building & Profiling (LLM)**: The AI reads your deep Navidrome statistics (Top 500, Favorites, Recents), understands your custom mood instructions, and plans a "Research Strategy" (e.g., *Search for French House*, *Find similar artists to Daft Punk*).
2.  **Candidate Gathering (API)**: The system executes the AI's research strategy by pinging Deezer and iTunes APIs to build a pool of 100% real, playable candidate tracks. It tags these tracks with "Source Features".
3.  **Scoring (LLM & Neural Network)**: The LLM rates every candidate track from 0-10 on how well it fits your profile. Then, the Mathematical Engine multiplies these ratings by your personalized Weights (learned via Backpropagation) to calculate a `Final Score`.
4.  **Threshold Download**: Any track that scores higher than your configured `Min Download Score` (default: 0.75, representing a 75% confidence probability) is queued and automatically downloaded via the background worker.

---

## 🚀 Installation & Setup

### Prerequisites
*   [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)
*   An [OpenRouter API Key](https://openrouter.ai/) (to use top-tier LLMs for cheap/free)
*   [Musikat](https://github.com/soggy8/musikat): This project relies on Musikat for the actual downloading of the selected tracks. You must have a Musikat instance running.
*   *(Optional but recommended)* A [Navidrome](https://www.navidrome.org/) Server

### Quick Start (Docker)

1.  Clone the repository:
    ```bash
    git clone https://github.com/BenceGyurus/music-suggester.git
    cd music-suggester
    ```

2.  Run with Docker Compose:
    ```bash
    docker-compose up -d
    ```

3.  Open the Web UI:
    Navigate to `http://localhost:3000` in your browser.

4.  Configuration:
    *   Go to **Settings** and enter your OpenRouter API Key.
    *   Connect your Navidrome account to enable deep personalization.
    *   Set your **Min Download Score** and let the AI do the work!

---

## 💻 Tech Stack

*   **Backend**: Node.js, Express, SQLite3, Jest
*   **Frontend**: React, Vite, Tailwind CSS, Shadcn UI
*   **AI Integration**: OpenRouter API (Access to Gemini 1.5 Pro, Claude 3.5 Sonnet, GPT-4o, Llama 3)
*   **Music Metadata**: Deezer API, iTunes Search API, Subsonic API

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check [issues page](https://github.com/BenceGyurus/music-suggester/issues) if you want to contribute.

## 📝 License

This project is [MIT](LICENSE) licensed.
