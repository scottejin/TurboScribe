# TurboScribe

TurboScribe is a macOS desktop app for local speech-to-text transcription using **Whisper large-v3-turbo**.

## Features

- Native desktop GUI (Electron)
- Upload-first transcription workflow (audio/video file input)
- Polished upload UX:
  - drag-and-drop zone
  - file picker
  - paste local file path with Cmd/Ctrl+V
- Top-right **Settings drawer** with all setup/update controls in one place
- One-time **onboarding setup** flow for first-time users
- Top-bar **Dark/Light switch** with **system-theme auto mode**
- Space-efficient full-window transcript layout
- Transcript panel optimized for readability (latest section visible in-app, full text preserved in desktop export)
- Inline runtime telemetry (CPU + estimated watts) beside progress/ETA
- Improved Whisper launch/runtime status details
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
4. Add an input file using any of:
   - drag-and-drop
   - file picker
   - paste local file path (Cmd/Ctrl+V)
5. Click **Start transcription**.
6. Open exported TXT after completion.

### Updating the app

1. Open **Settings**.
2. Click **Check for updates**.
3. If a newer version is found, click **Download & open update**.
4. Replace the app in Applications to finish the update.

## Output locations

- Whisper model: `~/.cache/whisper/large-v3-turbo.pt`
- Full transcript TXT exports: `~/Desktop/TurboScribe Exports`
- Downloaded update installers: `~/Downloads/TurboScribe/updates`

## Security and distribution notes

- Current builds are unsigned (Gatekeeper may show a first-launch warning).
- For frictionless updates, add Apple code signing + notarization in release builds.

## License

MIT
