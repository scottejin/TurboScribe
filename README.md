# TurboScribe

TurboScribe is a macOS desktop app for local speech-to-text transcription using **Whisper large-v3-turbo**.

## Features

- Native desktop GUI (Electron)
- Top-right **Settings drawer** with all setup/update controls in one place
- One-time **onboarding setup** flow for first-time users
- Top-bar **Dark/Light switch** with **system-theme auto mode**
- Space-efficient full-window layout for transcript focus
- Transcript panel optimized for readability (latest section visible in-app, full text preserved in desktop export)
- Two input modes:
  - **File transcription** (audio/video file)
  - **Realtime recording**
    - Voice recording from microphone
    - Screen-audio recording flow (enable audio in share dialog)
- Realtime Whisper pipeline with:
  - Live provisional transcript blocks
  - Final high-accuracy pass on stop (default `large-v3`)
- Task mode support:
  - Transcribe in source language
  - Translate to English while processing
- Improved Whisper launch/runtime status details
- Progress + ETA behavior tuned for difficult media timelines
- Built-in **release updater** (checks GitHub releases, downloads installer, opens it)
- Built-in **dependency installer** for `openai-whisper` and `ffmpeg`
- Guided Homebrew bootstrap button (if Homebrew is missing)

## Requirements

- macOS
- Node.js 20+

If Homebrew is already installed, dependencies can be installed in-app from **Settings**.

Manual command (optional):

```bash
brew install openai-whisper ffmpeg
```

## Development

```bash
npm install
npm run dev
```

## Build installer (DMG)

```bash
npm install
npm run dist
```

DMG output will be in `dist/`.

## Usage

1. Open TurboScribe.
2. In **Settings**, click **Install/repair dependencies** (first run).
3. Click **Download large-v3-turbo model** (first run).

### File mode

4. Choose **File transcription** mode.
5. Pick an audio/video file.
6. Click **Start transcription**.

### Realtime mode

4. Choose **Live recording** mode.
5. Pick source:
   - Voice recording (microphone), or
   - Screen audio recording
6. Choose task (Transcribe or Translate).
7. Click **Start live recording**, then **Stop & finalize** when done.

### Updating the app

1. Open **Settings**.
2. Click **Check for updates**.
3. If a newer version is found, click **Download & open update**.
4. Replace the app in Applications to finish the update.

## Output locations

- Whisper model: `~/.cache/whisper/large-v3-turbo.pt`
- Full transcript TXT exports: `~/Desktop/TurboScribe Exports`
- Live-session metadata JSON exports: `~/Desktop/TurboScribe Exports`
- Downloaded update installers: `~/Downloads/TurboScribe/updates`

## Security and distribution notes

- Current builds are unsigned (Gatekeeper may show a first-launch warning).
- For frictionless updates, add Apple code signing + notarization in release builds.

## License

MIT
