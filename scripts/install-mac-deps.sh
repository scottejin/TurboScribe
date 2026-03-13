#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh"
  exit 1
fi

brew install openai-whisper ffmpeg

echo "Done. You can now run: npm install && npm run dev"
