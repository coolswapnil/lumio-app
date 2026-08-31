# Lumio - Universal Save for Later App

[![Build APK](https://github.com/coolswapnil/lumio-app/actions/workflows/build-apk.yml/badge.svg)](https://github.com/coolswapnil/lumio-app/actions/workflows/build-apk.yml)
[![Latest Release](https://img.shields.io/github/v/release/coolswapnil/lumio-app?label=Download%20APK)](https://github.com/coolswapnil/lumio-app/releases/latest)

A personal knowledge hub for Android built with React Native (Expo). Save **anything** - links, videos, recipes, books, movies, workouts, travel destinations, restaurants, tools, and ideas - all in one place with AI-powered summaries and location tracking.

---

## Features

| Feature | Description |
|---|---|
| **Universal Save** | Save web links, YouTube videos, recipes, books, movies, workouts, places, restaurants, tools, and personal ideas |
| **Smart Collections** | Organize items into custom collections with icons and colors |
| **AI Auto-fill** | One-tap AI summarization and tagging using your own API key |
| **Location Saving** | Store place names, addresses and GPS coordinates from any saved content |
| **Open in Google Maps** | One tap to open any saved location in the Google Maps app |
| **Search & Filter** | Full-text search + filter by type, favorites, or completed status |
| **Local-first Storage** | All data stored on-device via SQLite - no cloud, no account required |
| **Dark Mode** | Full light / dark / system theme support |
| **Mark as Done** | Turn saved ideas into completed actions |

---

## AI Providers

Configure any of the following in **Settings > AI Provider**:

| Provider | Models |
|---|---|
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo |
| **Anthropic Claude** | claude-3-5-sonnet, claude-3-haiku, claude-3-opus |
| **Google Gemini** | gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro |
| **DeepSeek** | deepseek-chat, deepseek-reasoner |
| **Groq** | llama-3.3-70b-versatile, mixtral-8x7b, gemma2-9b |
| **Indus** | indus-1, indus-multilingual |
| **IBM watsonx** | granite-13b-instruct, granite-3-8b-instruct, llama-3-1-70b |
| **Local LLM** | Ollama, LM Studio, or any OpenAI-compatible local server |

API keys are stored **encrypted on-device** using Expo SecureStore (Android Keystore) and never sent anywhere except your chosen provider's API endpoint.

---

## Tech Stack

- **React Native** (Expo SDK 51) - cross-platform Android app
- **expo-router** - file-based navigation
- **expo-sqlite** - local relational storage (WAL mode)
- **expo-secure-store** - AES-256 encrypted key storage
- **expo-location** - free GPS coordinates, no API key needed
- **TypeScript** - fully typed codebase

---

## Getting Started

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)

```bash
npm install -g expo-cli
```

### Install and run locally

```bash
git clone https://github.com/coolswapnil/lumio-app.git
cd lumio-app
npm install
npx expo start --android
```

---

## Building the APK via GitHub Actions

The repo includes a ready-made workflow at `.github/workflows/build-apk.yml`.
**No Android Studio, no Expo account, no local Android SDK needed.**

### Trigger a build by tagging a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will automatically:
1. Install dependencies
2. Run `expo prebuild` to generate the native Android project
3. Compile the APK using Gradle on an Ubuntu runner
4. Create a **GitHub Release** with `lumio-v1.0.0.apk` attached

### Which APK to download

| File | Best for | Size |
|---|---|---|
| `lumio-vX.X.X-arm64-v8a.apk` | **Recommended** - Most phones (2018+, 64-bit ARM) | Smallest |
| `lumio-vX.X.X-armeabi-v7a.apk` | Older phones (32-bit ARM, pre-2018) | Small |
| `lumio-vX.X.X-universal.apk` | Any Android device - use if unsure | Largest |

> Not sure? Download the **universal** APK - it works on all Android devices.

### Download and install

1. Go to the **Releases** tab: `github.com/coolswapnil/lumio-app/releases`
2. Download the APK for your device from **Assets**
3. On your Android device: **Settings > Security > Install unknown apps** - enable for your browser or Files app
4. Open the downloaded APK and tap **Install**

### Manual trigger (no tag needed)

Go to: **Actions tab > Build Android APK > Run workflow**

---

## Project Structure

```
lumio-app/
+-- app/                        # Expo Router screens
|   +-- (tabs)/
|   |   +-- index.tsx           # Library (home feed)
|   |   +-- collections.tsx     # Collections list + create
|   |   +-- map.tsx             # Locations list + Open in Maps
|   |   +-- settings.tsx        # AI provider config + appearance
|   +-- save.tsx                # Save item modal
|   +-- item/[id].tsx           # Item detail view
|   +-- collection/[id].tsx     # Collection detail view
|   +-- _layout.tsx             # Root layout + providers
+-- src/
|   +-- components/             # Reusable UI components
|   +-- context/                # React context (theme, data)
|   +-- database/               # SQLite queries (items, collections)
|   +-- services/               # AI service (8 providers), settings
|   +-- constants/              # Content types, colors, icons
|   +-- types/                  # TypeScript type definitions
+-- .github/workflows/          # GitHub Actions CI
+-- app.json                    # Expo config
+-- eas.json                    # EAS Build profiles
+-- package.json
```

---

## Location Feature

When saving any content (YouTube video, Instagram reel, recipe, etc.):

- **Address field** - type or paste the place name from the content
- **GPS button** - capture your current coordinates via `expo-location` (free, no API key)

Both are stored as metadata. On the **Locations tab** you can search all saved places and tap **Open in Google Maps** to launch the Maps app directly:

- If GPS coordinates are stored: opens an exact pin on the map
- If only address text: searches Google Maps for the place name

---

## Security

- API keys stored with **Expo SecureStore** (AES-256 encrypted on Android Keystore)
- Data stored locally only - no external servers, no analytics, no telemetry
- No credentials are logged or exposed in error messages
- TLS used for all AI provider API calls

---

## License

MIT - free to use, modify, and distribute.
