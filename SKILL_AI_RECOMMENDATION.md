# AI Recommendation Architecture & Learnings

## Overview
This document outlines the architecture of the AI recommendation system in this project, specifically detailing why we abandoned native OpenAI `tools` (tool-calling) in favor of a custom Multi-Phase Agentic Workflow.

## The Problem with Native Tool-Calling
Initially, the project attempted to use the standard OpenAI `tools` and `tool_calls` format when querying the OpenRouter API (using models like Nemotron-3).
- **Issue**: Open-source models (and even some proprietary ones) frequently struggle with the strict JSON schema required for native tool-calling. They would output malformed JSON, hallucinatory tool names, or inject conversational text inside the arguments, causing the backend parser to crash.
- **The "Infinite Loop"**: To combat this, we had a `for` loop that retried the AI up to 10 times if it failed to output correct tool calls. This caused massive delays, high API costs, and a feeling that the system was "hanging forever".

## The Solution: 3-Phase Agentic Workflow
We replaced native tool-calling with an explicit, prompt-engineered 3-Phase pipeline. This leverages the AI's natural language comprehension rather than forcing it into strict API schemas.

### Phase 1: Profiling and Strategy
- The AI is fed the user's history (recently played, top played, blacklisted artists, and explicit user mood).
- It is instructed to output a simple, raw JSON array of "commands" (e.g., `search`, `similar`, `trending`, `analyze_artist`).
- We limit the execution to a maximum of 4 commands to prevent spam.

### Phase 2: Execution (Backend)
- The Node.js backend safely parses the JSON. If the AI fails to output valid JSON after 3 retries, the backend catches the error and executes a default `trending` search instead of hanging forever.
- The backend runs these commands against the Deezer/iTunes APIs and compiles the results into a text string (`gatheredData`).

### Phase 3: Final Generation
- We call the AI a second time, passing both the original User Profile and the newly gathered Research Data.
- The AI is instructed to generate exactly 5 tracks as a raw JSON array.
- This phase successfully separates the "thinking/research" from the "generation", resulting in significantly higher quality recommendations without the fragility of native tool calls.

## Best Practices for Enhancing the AI
- **Play Counts**: Passing grouped play counts (`Plays: 12`) is far more effective than just listing a track 12 times in the prompt.
- **Blacklists**: Grouping disliked tracks by artist and blacklisting the whole artist prevents the AI from repeatedly recommending artists the user clearly hates.
- **Explicit Prompting**: Giving the user a "Mood / Instructions" text field overrides the AI's implicit guesses with explicit instructions (e.g., "Only Hungarian rap").
