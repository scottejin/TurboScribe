# TurboScribe

A macOS desktop app for local speech-to-text transcription using **Whisper large-v3-turbo**.

## What it does

- Native desktop GUI (Electron)
- One-click download of the Whisper `large-v3-turbo` model
- File picker for audio/video input
- Live transcript updates while processing
- Progress bar with estimated time remaining
- Transcript output saved as `.txt`

## Why TurboScribe

- Fully local transcription workflow
- Fast default model for everyday use
- Simple install via DMG

## Requirements

- macOS
- Node.js 20+
- Homebrew
- Dependencies:
  - `openai-whisper`
  - `ffmpeg`

Install required tools:

```bash
brew install openai-whisper ffmpeg
```

## Run locally (development)

```bash
npm install
npm run dev
```

## Build installer (DMG)

```bash
npm install
npm run dist
```

The DMG will be generated in `dist/`.

## Usage

1. Open TurboScribe.
2. Click **Download large-v3-turbo model** (first run only).
3. Choose an audio/video file.
4. Click **Start transcription**.
5. Watch live transcript + progress/ETA.
6. Open transcript output from Finder.

## Output locations

- Model: `~/.cache/whisper/large-v3-turbo.pt`
- Transcripts: `~/Documents/TurboScribe/Transcripts`

## Roadmap

- Optional SRT/VTT export UI
- Model selector (turbo / large-v3 / medium)
- Code signing + notarization pipeline
- Batch file queue

## License

MIT
