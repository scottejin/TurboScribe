# TurboScribe

TurboScribe is a macOS desktop app for local speech-to-text transcription using **Whisper large-v3-turbo**.

## Features

- Native desktop GUI (Electron)
- One-click download of Whisper `large-v3-turbo`
- File picker for audio/video input
- Live transcript updates while processing
- Progress bar with ETA during transcription
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
4. Choose an audio/video file.
5. Click **Start transcription**.
6. Watch live transcript + progress/ETA.

### Updating the app

1. Open **Settings**.
2. Click **Check for updates**.
3. If a newer version is found, click **Download & open update**.
4. Replace the app in Applications to finish the update.

## Output locations

- Whisper model: `~/.cache/whisper/large-v3-turbo.pt`
- Transcripts: `~/Documents/TurboScribe/Transcripts`
- Downloaded update installers: `~/Downloads/TurboScribe/updates`

## Security and distribution notes

- Current builds are unsigned (Gatekeeper may show a first-launch warning).
- For frictionless updates, add Apple code signing + notarization in release builds.

## License

MIT
