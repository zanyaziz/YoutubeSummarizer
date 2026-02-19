# YT-Video-Translator-Summarizer

An autonomous AI pipeline that monitors a YouTube channel for new uploads, downloads the audio, transcribes it locally with Whisper, translates non-English content to English with Ollama, generates a summary and key insights, and publishes a styled HTML knowledge base — all running **100% locally** with no external API keys.

---

## How It Works

```
YouTube Channel
      │
      ▼
 [1] Watchman       — checks for a new video not yet in history
      │
      ▼
 [2] Extractor      — downloads audio (yt-dlp) + transcribes (Whisper)
      │
      ▼
 [3] Translator     — translates non-English transcript → English (Ollama)
      │
      ▼
 [4] Analyst        — summarises + extracts 10 key insights (Ollama)
      │
      ▼
 [5] Librarian      — writes styled HTML page + updates library index
```

Each stage streams live progress to the terminal so you always know what's happening.

---

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| [Node.js](https://nodejs.org) ≥ 20 | Runtime | `brew install node` |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube audio download | `brew install yt-dlp` |
| [ffmpeg](https://ffmpeg.org) | Audio conversion (used by yt-dlp) | `brew install ffmpeg` |
| [Python 3](https://python.org) + [openai-whisper](https://github.com/openai/whisper) | Local transcription | `pip install openai-whisper` |
| [Ollama](https://ollama.com) + llama3.2 | Local LLM for translation & analysis | `brew install ollama` then `ollama pull llama3.2` |

> **Note:** Whisper and Ollama both run locally — no API keys or internet connection needed after the initial model downloads.

---

## Installation

```bash
git clone https://github.com/zanyaziz/YoutubeSummarizer.git
cd YoutubeSummarizer
npm install
```

---

## Usage

Start Ollama in the background (if it isn't already running):
```bash
ollama serve
```

Then run the pipeline against any YouTube channel:
```bash
npm start -- https://www.youtube.com/@<channel_name>
```

The pipeline will:
1. Check if the latest video has already been processed (skips if so)
2. Download and transcribe the audio
3. Translate the transcript to English if needed
4. Generate a summary and 10 key insights
5. Save a styled HTML page to `library/`

---

## Output

After a successful run you'll find:

```
library/
├── index.html              ← browsable library of all processed videos
└── <video-id>.html         ← individual summary page for the video
```

Open `library/index.html` in any browser to browse your local knowledge base.

Each video page includes:
- Video thumbnail, title, channel, and duration
- 3–5 sentence summary
- Top 10 key insights
- Full English transcript
- Original transcript (if translated), shown in the source language with RTL support

---

## Project Structure

```
src/
├── index.ts                ← pipeline entry point & stage orchestration
├── types.ts                ← shared TypeScript interfaces
├── agents/
│   ├── watchman.ts         ← checks channel for unprocessed videos
│   ├── extractor.ts        ← audio download + Whisper transcription
│   ├── translator.ts       ← chunked Ollama translation (non-English → English)
│   ├── analyst.ts          ← Ollama summarisation + insights extraction
│   └── librarian.ts        ← HTML generation + history tracking
└── tools/
    ├── youtube.ts          ← yt-dlp wrapper tool
    ├── transcription.ts    ← Whisper wrapper tool
    ├── history.ts          ← JSON-based processed-video history
    └── html.ts             ← HTML template generation tools
```

---

## Configuration

Key constants are defined at the top of each agent file:

| File | Constant | Default | Notes |
|------|----------|---------|-------|
| `analyst.ts` | `OLLAMA_MODEL` | `llama3.2` | LLM used for summarisation |
| `analyst.ts` | `MAX_TRANSCRIPT_CHARS` | `10,000` | Truncation limit for analyst context |
| `translator.ts` | `CHUNK_SIZE` | `2,000` | Characters per translation chunk |
| `translator.ts` | `OLLAMA_TIMEOUT_MS` | `600,000` | 10 min per chunk |

> **Performance tip:** The pipeline sets `num_ctx` explicitly (`8192` for translation, `16384` for analysis) to keep Ollama's KV cache on-GPU. Leaving it at the llama3.2 default of 131072 forces the cache into CPU RAM and reduces throughput to ~0.5 tok/s.

---

## Tech Stack

- **[VoltAgent](https://voltagent.dev)** — TypeScript agent framework (Supervisor + Subagent pattern)
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — YouTube audio extraction
- **[OpenAI Whisper](https://github.com/openai/whisper)** — local speech-to-text (`base` model by default)
- **[Ollama](https://ollama.com)** — local LLM inference (`llama3.2`)
- **TypeScript + tsx** — ESM TypeScript runtime, no build step needed

---

## License

MIT
