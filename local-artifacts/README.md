# PocketMind

Private, offline-first Android chat and interactive-artifact workspace for Pixel-class phones.

## What is implemented

- ChatGPT-style chat UI with streaming local inference.
- Model manager for Gemma 4 E4B QAT and Qwen 3.5 4B GGUF downloads.
- SQLite persistence for chats, artifacts, and data saved by artifacts.
- Offline WebView artifact sandbox for games, dashboards, trackers, and spreadsheets.
- Optional Tavily web search with an encrypted API-key setting and source context passed to the local model.
- Light/dark system theme support.
- Hebrew and English prompts.

## Important Pixel 10a note

The Pixel 10a has a Mali GPU. `llama.rn` currently documents its OpenCL/Hexagon backend for Qualcomm devices, so the app defaults to CPU inference on Pixel 10a and does not compile the optional Qualcomm backend. The model engine and UI remain local; this is a compatibility choice, not a cloud fallback.

## Run and build

This app requires a development/custom Android build because `llama.rn` is a native module. Expo Go is not sufficient.

```bash
npm install
npx expo prebuild --platform android
npx expo run:android --variant release
```

For a standalone release APK:

```bash
cd android
./gradlew assembleRelease
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

On first launch, open Models, download one model over Wi-Fi, load it, and then start chatting. The model files are several gigabytes and are stored in the app's private document directory.
