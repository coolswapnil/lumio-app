# Lumio — Universal Save for Later App

A personal knowledge hub for Android built with React Native (Expo). Save **anything** — links, videos, recipes, books, movies, workouts, travel destinations, restaurants, tools, and ideas — all in one place with AI-powered summaries and a built-in map.

---

## Features

| Feature | Description |
|---|---|
| **Universal Save** | Save web links, YouTube videos, recipes, books, movies, workouts, places, restaurants, tools, and personal ideas |
| **Smart Collections** | Organize items into custom collections with icons and colors |
| **AI Auto-fill** | One-tap AI summarization and tagging using your own API key |
| **Location Mapping** | Pin saved places on an interactive map |
| **Search & Filter** | Full-text search + filter by type, favorites, or completed status |
| **Local-first Storage** | All data stored on-device via SQLite — no cloud, no account |
| **Dark Mode** | Full light/dark/system theme support |
| **Mark as Done** | Turn saved ideas into completed actions |

---

## AI Providers

Configure any of the following in **Settings → AI Provider**:

| Provider | Models |
|---|---|
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo |
| **Anthropic Claude** | claude-3-5-sonnet, claude-3-haiku, claude-3-opus |
| **Google Gemini** | gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash |
| **IBM watsonx** | granite-13b-instruct, granite-3-8b-instruct, llama-3-1-70b |

API keys are stored **encrypted on-device** using Expo SecureStore and never sent anywhere except your chosen provider's API.

---

## Tech Stack

- **React Native** (Expo SDK 51) — cross-platform mobile
- **expo-router** — file-based navigation
- **expo-sqlite** — local relational storage
- **expo-secure-store** — encrypted key storage
- **react-native-maps** — interactive place mapping
- **expo-location** — GPS coordinates for saved places
- **TypeScript** — fully typed codebase

---

## Getting Started

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)

```bash
npm install -g expo-cli eas-cli
```

### Install & Run

```bash
git clone https://github.com/YOUR_USERNAME/albo-app.git
cd albo-app
npm install
npx expo start --android
```

### Build APK (Android)

Using [EAS Build](https://docs.expo.dev/build/introduction/) (free tier available):

```bash
# Login to Expo
eas login

# Build preview APK
eas build --platform android --profile preview
```

The APK download link will be printed when the build completes.

### Build locally (without EAS)

```bash
# Requires Android SDK + JDK installed
npx expo run:android
```

---

## Project Structure

```
albo-app/
├── app/                        # Expo Router screens
│   ├── (tabs)/
│   │   ├── index.tsx           # Library (home)
│   │   ├── collections.tsx     # Collections list
│   │   ├── map.tsx             # Location map
│   │   └── settings.tsx        # AI config + appearance
│   ├── save.tsx                # Save item modal
│   ├── item/[id].tsx           # Item detail
│   └── collection/[id].tsx     # Collection detail
├── src/
│   ├── components/             # Reusable UI components
│   ├── context/                # React context (theme, data)
│   ├── database/               # SQLite queries
│   ├── services/               # AI service, settings
│   ├── constants/              # Content types, colors, icons
│   └── types/                  # TypeScript types
├── app.json                    # Expo config
├── eas.json                    # EAS Build profiles
└── package.json
```

---

## Security

- API keys stored with **Expo SecureStore** (AES-256 encrypted on Android Keystore)
- Data stored locally only — no external servers, no analytics
- No credentials are logged or exposed in error messages
- TLS used for all AI provider API calls

---

## Adding Google Maps (required for Map tab)

1. Get a [Google Maps API key](https://console.cloud.google.com/apis/credentials)
2. Add it to `app.json` under `expo.android.config.googleMaps.apiKey`

---

## License

MIT — free to use, modify, and distribute.
