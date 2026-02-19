import { createTool } from "@voltagent/core";
import { z } from "zod";
import { execSync, spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Python whisper script path
const WHISPER_SCRIPT = resolve(__dirname, "..", "..", "whisper_transcribe.py");

// Always write the whisper helper script so updates take effect
function ensureWhisperScript(): void {
  const script = `#!/usr/bin/env python3
import sys
import json
import whisper

def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)

def transcribe(audio_path: str, model_size: str = "base") -> dict:
    log(f"[Whisper] Loading '{model_size}' model...")
    model = whisper.load_model(model_size)
    log(f"[Whisper] Model loaded. Starting transcription...")
    log(f"[Whisper] Audio file: {audio_path}")
    log("[Whisper] Progress (each dot = one segment decoded):")
    result = model.transcribe(audio_path, verbose=True)
    lang = result.get("language", "unknown")
    seg_count = len(result.get("segments", []))
    log(f"[Whisper] Done. Language: {lang}, Segments: {seg_count}")
    return {
        "text": result["text"].strip(),
        "language": lang,
        "segments": [
            {"start": s["start"], "end": s["end"], "text": s["text"]}
            for s in result.get("segments", [])
        ]
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: whisper_transcribe.py <audio_path> [model_size]"}))
        sys.exit(1)
    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"
    try:
        result = transcribe(audio_path, model_size)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
`;
  writeFileSync(WHISPER_SCRIPT, script, "utf-8");
}

function findPython(): string {
  const candidates = [
    "/Users/zaziz/miniconda3/bin/python3",
    "python3",
    "python",
  ];
  for (const c of candidates) {
    try {
      execSync(`${c} -c "import whisper"`, { stdio: "pipe" });
      return c;
    } catch {
      continue;
    }
  }
  throw new Error(
    "Python with openai-whisper not found. Install with: pip install openai-whisper"
  );
}

export const transcribeAudioTool = createTool({
  name: "transcribe_audio",
  description:
    "Transcribe an audio file using local OpenAI Whisper model. Returns the full verbatim transcript text.",
  parameters: z.object({
    audioPath: z
      .string()
      .describe("Absolute path to the audio file to transcribe"),
    modelSize: z
      .enum(["tiny", "base", "small", "medium", "large"])
      .default("base")
      .describe(
        "Whisper model size. 'base' is recommended for speed/quality balance."
      ),
  }),
  execute: async ({ audioPath, modelSize }) => {
    ensureWhisperScript();
    const python = findPython();

    if (!existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    console.log(`[Transcription] Starting Whisper (${modelSize}) on: ${audioPath}`);
    console.log(`[Transcription] This may take several minutes — progress will appear below:`);

    return new Promise((resolve, reject) => {
      // Spawn python: stdout captured for JSON, stderr inherited so Whisper progress streams live
      const proc = spawn(python, [WHISPER_SCRIPT, audioPath, modelSize], {
        stdio: ["ignore", "pipe", "inherit"],
      });

      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      // Heartbeat: reassure the user every 60s while Whisper is running
      const startTime = Date.now();
      const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[Transcription] Still running... (${elapsed}s elapsed)`);
      }, 60_000);

      const cleanup = () => clearInterval(heartbeat);

      // Hard timeout: 30 minutes
      const timeoutId = setTimeout(() => {
        cleanup();
        proc.kill("SIGTERM");
        reject(new Error("Whisper transcription timed out after 30 minutes"));
      }, 1_800_000);

      proc.on("close", (code) => {
        cleanup();
        clearTimeout(timeoutId);

        if (code !== 0) {
          return reject(new Error(`Whisper exited with code ${code}`));
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (result.error) return reject(new Error(result.error));

          console.log(
            `[Transcription] Complete. Language: ${result.language}, Length: ${result.text.length} chars`
          );
          resolve({
            text: result.text,
            language: result.language || "unknown",
            charCount: result.text.length,
            wordCount: result.text.split(/\s+/).length,
          });
        } catch (parseErr) {
          reject(new Error(`Failed to parse Whisper output: ${String(parseErr)}\nRaw: ${stdout.slice(0, 500)}`));
        }
      });

      proc.on("error", (err) => {
        cleanup();
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn Python: ${err.message}`));
      });
    });
  },
});
