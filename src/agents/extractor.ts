/**
 * Extractor Agent — downloads audio and generates a full verbatim transcript.
 * Uses yt-dlp for audio download and local OpenAI Whisper for transcription.
 * Caches transcription results to avoid re-running Whisper.
 */
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { downloadAudioTool } from "../tools/youtube.js";
import { transcribeAudioTool } from "../tools/transcription.js";
import type { VideoInfo, TranscriptionResult } from "../types.js";

const AUDIO_DIR = resolve(process.cwd(), "audio");

export async function extractTranscript(
  video: VideoInfo
): Promise<TranscriptionResult> {
  console.log(`[Extractor] Downloading audio for: ${video.title}`);

  // Step 1: Download audio (cached if already present)
  const downloadResult = (await downloadAudioTool.execute(
    { videoId: video.id, outputDir: AUDIO_DIR },
    {} as never
  )) as { audioPath: string; videoId: string };

  console.log(`[Extractor] Audio saved to: ${downloadResult.audioPath}`);

  // Step 2: Check transcript cache
  const cacheFile = resolve(AUDIO_DIR, `${video.id}.transcript.json`);
  if (existsSync(cacheFile)) {
    console.log(`[Extractor] Using cached transcript: ${cacheFile}`);
    const cached = JSON.parse(readFileSync(cacheFile, "utf-8")) as TranscriptionResult;
    console.log(
      `[Extractor] Cached transcript: ${cached.text.split(/\s+/).length} words, language: ${cached.language}`
    );
    return cached;
  }

  // Step 3: Transcribe with Whisper
  console.log(
    `[Extractor] Transcribing with Whisper (this may take 15-20 minutes for a 20-min video)...`
  );
  const transcriptionResult = (await transcribeAudioTool.execute(
    { audioPath: downloadResult.audioPath, modelSize: "base" },
    {} as never
  )) as { text: string; language: string; charCount: number; wordCount: number };

  console.log(
    `[Extractor] Transcript: ${transcriptionResult.wordCount} words, language: ${transcriptionResult.language}`
  );

  const result: TranscriptionResult = {
    text: transcriptionResult.text,
    language: transcriptionResult.language,
  };

  // Save to cache
  writeFileSync(cacheFile, JSON.stringify(result, null, 2), "utf-8");
  console.log(`[Extractor] Transcript cached to: ${cacheFile}`);

  return result;
}
