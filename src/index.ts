/**
 * YT-Channel-Sentinel
 * =====================
 * Supervisor entry point that orchestrates the full pipeline:
 * Watchman → Extractor → Analyst → Librarian
 */
import { VoltAgent, Agent } from "@voltagent/core";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { checkForNewVideo } from "./agents/watchman.js";
import { extractTranscript } from "./agents/extractor.js";
import { translateTranscript } from "./agents/translator.js";
import { analyzeTranscript } from "./agents/analyst.js";
import { publishToLibrary } from "./agents/librarian.js";

import { getLatestVideoTool, downloadAudioTool } from "./tools/youtube.js";
import {
  checkVideoInHistoryTool,
  readHistoryTool,
  saveToHistoryTool,
} from "./tools/history.js";
import { transcribeAudioTool } from "./tools/transcription.js";
import { generateSummaryHtmlTool, updateIndexHtmlTool } from "./tools/html.js";

// ── Channel URL from CLI argument ──────────────────────────────────────────────
// Usage: npm start -- <channel_url>
// e.g.:  npm start -- https://www.youtube.com/@<channel_name>
const CHANNEL_URL = process.argv[2]?.trim();
if (!CHANNEL_URL) {
  console.error("Error: no channel URL provided.");
  console.error("Usage: npm start -- <youtube_channel_url>");
  console.error("  e.g: npm start -- https://www.youtube.com/@<channel_name>");
  process.exit(1);
}

// ── Ollama via OpenAI-compatible API ───────────────────────────────────────────
const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: "http://localhost:11434/v1",
  apiKey: "ollama",
});

const OLLAMA_MODEL = "llama3.2";

// ── Sub-Agents (VoltAgent Supervisor-Subagent pattern) ──────────────────────────
const watchmanAgent = new Agent({
  name: "Watchman",
  instructions:
    "Monitor a YouTube channel for new unprocessed videos. Check the channel, compare with history, and return whether a new video was found.",
  model: ollama(OLLAMA_MODEL),
  tools: [getLatestVideoTool, checkVideoInHistoryTool, readHistoryTool],
  memory: false,
});

const extractorAgent = new Agent({
  name: "Extractor",
  instructions:
    "Download audio from YouTube videos and transcribe them using local Whisper. Return the full verbatim transcript.",
  model: ollama(OLLAMA_MODEL),
  tools: [downloadAudioTool, transcribeAudioTool],
  memory: false,
});

const analystAgent = new Agent({
  name: "Analyst",
  instructions:
    "Analyze video transcripts. Generate a concise 3-5 sentence summary and a Top 10 key insights list in JSON format.",
  model: ollama(OLLAMA_MODEL),
  memory: false,
});

const librarianAgent = new Agent({
  name: "Librarian",
  instructions:
    "Generate styled HTML summary pages for analyzed videos and maintain the library index page.",
  model: ollama(OLLAMA_MODEL),
  tools: [generateSummaryHtmlTool, updateIndexHtmlTool, saveToHistoryTool],
  memory: false,
});

// ── Supervisor ─────────────────────────────────────────────────────────────────
const supervisorAgent = new Agent({
  name: "Supervisor",
  instructions: `You are the YT-Channel-Sentinel supervisor orchestrating the full pipeline:
1. Watchman monitors the YouTube channel for new videos
2. Extractor downloads audio and transcribes with local Whisper
3. Translator translates non-English transcripts to English using local Ollama
4. Analyst summarizes the English content using local Ollama
5. Librarian generates the HTML knowledge base`,
  model: ollama(OLLAMA_MODEL),
  subAgents: [watchmanAgent, extractorAgent, analystAgent, librarianAgent],
  memory: false,
});

const TOTAL_STAGES = 5;

function stageHeader(n: number, label: string): void {
  console.log(`\n┌─────────────────────────────────────────────────────┐`);
  console.log(`│  Stage ${n}/${TOTAL_STAGES}: ${label.padEnd(44)}│`);
  console.log(`└─────────────────────────────────────────────────────┘`);
}

function stageDone(n: number, label: string, elapsed: number): void {
  console.log(`[Stage ${n}/${TOTAL_STAGES}] ✓ ${label} — done in ${elapsed}s`);
}

function elapsed(start: number): number {
  return Math.round((Date.now() - start) / 1000);
}

// ── Pipeline Runner ─────────────────────────────────────────────────────────────
async function runPipeline(): Promise<void> {
  const pipelineStart = Date.now();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  YT-Channel-Sentinel v1.0");
  console.log(`  Channel : ${CHANNEL_URL}`);
  console.log(`  Model   : ${OLLAMA_MODEL} (local Ollama)`);
  console.log(`  Started : ${new Date().toLocaleString()}`);
  console.log("═══════════════════════════════════════════════════════");

  // ── Stage 1: Watchman ──────────────────────────────────────────────────────
  stageHeader(1, "Watchman — checking for new videos");
  const t1 = Date.now();
  const video = await checkForNewVideo(CHANNEL_URL);

  if (!video) {
    console.log(`\n[Stage 1/5] ✓ No new videos — library is up to date. (${elapsed(t1)}s)`);
    console.log(`[Pipeline] Total time: ${elapsed(pipelineStart)}s\n`);
    return;
  }

  stageDone(1, "Watchman", elapsed(t1));
  console.log(`\n  Title    : ${video.title}`);
  console.log(`  Video ID : ${video.id}`);
  console.log(`  URL      : ${video.url}`);
  console.log(`  Duration : ${video.durationString}`);
  console.log(`  Channel  : ${video.channel}`);

  // ── Stage 2: Extractor ─────────────────────────────────────────────────────
  stageHeader(2, "Extractor — downloading audio + transcribing");
  console.log(`  [info] yt-dlp will download the audio, then Whisper (base)`);
  console.log(`  [info] transcribes locally. Progress streams below.`);
  const t2 = Date.now();
  const transcription = await extractTranscript(video);

  if (!transcription.text || transcription.text.trim().length < 50) {
    console.warn(`\n[Stage 2/${TOTAL_STAGES}] ⚠  Transcript is empty or too short — video may have no spoken audio.`);
  } else {
    stageDone(2, "Extractor", elapsed(t2));
    console.log(`  Language : ${transcription.language ?? "unknown"}`);
    console.log(`  Words    : ${transcription.text.split(/\s+/).length.toLocaleString()}`);
    console.log(`  Chars    : ${transcription.text.length.toLocaleString()}`);
  }

  // ── Stage 3: Translator ────────────────────────────────────────────────────
  stageHeader(3, "Translator — Urdu → English");
  console.log(`  [info] Non-English text will be chunked and translated`);
  console.log(`  [info] via local Ollama (${OLLAMA_MODEL}). English is skipped.`);
  const t3 = Date.now();
  const translation = await translateTranscript(
    transcription.text,
    transcription.language || "unknown"
  );

  stageDone(3, "Translator", elapsed(t3));
  if (translation.wasTranslated) {
    console.log(`  Source   : ${translation.sourceLang}`);
    console.log(`  Original : ${translation.originalText.length.toLocaleString()} chars`);
    console.log(`  English  : ${translation.translatedText.length.toLocaleString()} chars`);
  } else {
    console.log(`  Result   : already English — no translation needed`);
  }

  // ── Stage 4: Analyst ───────────────────────────────────────────────────────
  stageHeader(4, "Analyst — summarising with Ollama");
  console.log(`  [info] Generating a 3-5 sentence summary + 10 key insights`);
  console.log(`  [info] from the English transcript via ${OLLAMA_MODEL}.`);
  const t4 = Date.now();
  const analysis = await analyzeTranscript(translation.translatedText, video.title);

  stageDone(4, "Analyst", elapsed(t4));
  console.log(`  Summary  : ${analysis.summary.length} chars`);
  console.log(`  Insights : ${analysis.insights.length}`);

  // ── Stage 5: Librarian ─────────────────────────────────────────────────────
  stageHeader(5, "Librarian — publishing HTML");
  console.log(`  [info] Writing styled HTML page and updating library index.`);
  const t5 = Date.now();
  const htmlPath = await publishToLibrary(
    video,
    translation.translatedText,
    analysis,
    transcription.language || "unknown",
    translation.wasTranslated ? translation.originalText : undefined,
    translation.wasTranslated ? translation.sourceLang : undefined
  );

  stageDone(5, "Librarian", elapsed(t5));

  // ── Done ───────────────────────────────────────────────────────────────────
  const total = elapsed(pipelineStart);
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  ✅  Pipeline complete in ${total}s`);
  console.log(`  Video : ${video.title}`);
  console.log(`  HTML  : ${htmlPath}`);
  console.log(`  Index : ${process.cwd()}/library/index.html`);
  console.log(`═══════════════════════════════════════════════════════\n`);
}

// ── VoltAgent Boot ──────────────────────────────────────────────────────────────
new VoltAgent({
  agents: { supervisor: supervisorAgent },
});

// ── Main ───────────────────────────────────────────────────────────────────────
runPipeline().catch((err) => {
  console.error("[Pipeline] Fatal error:", err);
  process.exit(1);
});
