/**
 * Translator Agent — translates a non-English transcript to English using local Ollama.
 * Chunks long texts so each piece fits within llama3.2's context window.
 * Streams tokens so progress is visible during long translations.
 */
import type { TranslationResult } from "../types.js";

const OLLAMA_BASE = "http://localhost:11434";
const OLLAMA_MODEL = "llama3.2";
const OLLAMA_TIMEOUT_MS = 600_000; // 10 min per chunk (bumped from 5)

// Each chunk must leave room for the translated output too (~2× expansion)
const CHUNK_SIZE = 2_000; // reduced from 2500 to be safer with context limits

// Language codes Whisper reports as English
const ENGLISH_CODES = new Set(["en", "english"]);

// ── Ollama connectivity check ──────────────────────────────────────────────────
async function checkOllamaReady(): Promise<void> {
  console.log(`[Translator] Checking Ollama at ${OLLAMA_BASE}...`);
  let versionRes: Response;
  try {
    versionRes = await fetch(`${OLLAMA_BASE}/api/version`, { signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    throw new Error(
      `Cannot reach Ollama at ${OLLAMA_BASE}. Is it running? Start with: ollama serve\n  (${String(err)})`
    );
  }
  if (!versionRes.ok) throw new Error(`Ollama version check failed: HTTP ${versionRes.status}`);
  const version = (await versionRes.json()) as { version?: string };
  console.log(`[Translator] Ollama is up (v${version.version ?? "unknown"})`);

  // Check the model is available
  console.log(`[Translator] Verifying model '${OLLAMA_MODEL}' is loaded...`);
  const tagsRes = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  if (!tagsRes.ok) throw new Error(`Ollama tags check failed: HTTP ${tagsRes.status}`);
  const tags = (await tagsRes.json()) as { models?: Array<{ name: string }> };
  const available = tags.models?.map((m) => m.name) ?? [];
  const found = available.some((n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}:`));
  if (!found) {
    throw new Error(
      `Model '${OLLAMA_MODEL}' not found in Ollama. Available: ${available.join(", ") || "none"}\n` +
        `  Pull it with: ollama pull ${OLLAMA_MODEL}`
    );
  }
  console.log(`[Translator] Model '${OLLAMA_MODEL}' confirmed available.`);
}

// ── Text chunking ──────────────────────────────────────────────────────────────
function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  // Split on sentence boundaries when possible to avoid mid-sentence cuts
  const sentences = text.split(/(?<=[.!?۔؟])\s+/);
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).length > size && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Single chunk translation ───────────────────────────────────────────────────
async function translateChunk(
  text: string,
  sourceLang: string,
  chunkIndex: number,
  totalChunks: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  const chunkStart = Date.now();

  const prompt =
    `Translate the following ${sourceLang} text to English. ` +
    `Output ONLY the English translation — no explanations, no notes, no prefixes.\n\n` +
    `TEXT TO TRANSLATE:\n${text}\n\nENGLISH TRANSLATION:`;

  console.log(
    `[Translator] Chunk ${chunkIndex + 1}/${totalChunks}: ` +
      `${text.length} input chars, prompt ${prompt.length} chars, ` +
      `timeout ${OLLAMA_TIMEOUT_MS / 1000}s`
  );

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: true,
        // num_ctx MUST be set explicitly — llama3.2 defaults to 131072 which
        // forces the KV cache into CPU RAM and kills throughput (0.5 tok/s).
        // Our chunks are ~2000 chars (~500 tokens) + 4096 output = 8192 is plenty.
        options: { temperature: 0.1, num_predict: 4096, num_ctx: 8192 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    throw new Error(isTimeout ? `Timed out waiting for Ollama to start responding` : `Fetch error: ${String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  // Re-arm timeout for the streaming phase
  const streamController = new AbortController();
  const streamTimeoutId = setTimeout(() => streamController.abort(), OLLAMA_TIMEOUT_MS);

  if (!response.ok) {
    clearTimeout(streamTimeoutId);
    const body = await response.text();
    throw new Error(`Ollama HTTP ${response.status}: ${body}`);
  }
  if (!response.body) {
    clearTimeout(streamTimeoutId);
    throw new Error("Ollama response has no body");
  }

  console.log(`[Translator]   Streaming response...`);

  let translated = "";
  let tokenCount = 0;
  let lastHeartbeat = Date.now();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        throw new Error(
          isTimeout
            ? `Streaming timed out after ${Math.round((Date.now() - chunkStart) / 1000)}s (${tokenCount} tokens received so far)`
            : `Stream read error: ${String(err)}`
        );
      }

      if (readResult.done) break;

      lineBuffer += decoder.decode(readResult.value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as { response: string; done: boolean };
          translated += chunk.response;
          tokenCount++;
          if (tokenCount % 25 === 0) process.stdout.write(".");
          if (chunk.done) break;
        } catch {
          // skip malformed NDJSON lines
        }
      }

      // Heartbeat every 30s so the console doesn't go silent
      if (Date.now() - lastHeartbeat >= 30_000) {
        const elapsedS = Math.round((Date.now() - chunkStart) / 1000);
        const tps = tokenCount > 0 ? (tokenCount / elapsedS).toFixed(1) : "?";
        process.stdout.write(`\n[Translator]   ... ${tokenCount} tokens in ${elapsedS}s (${tps} tok/s)`);
        lastHeartbeat = Date.now();
      }
    }
  } finally {
    clearTimeout(streamTimeoutId);
  }

  const elapsedS = Math.round((Date.now() - chunkStart) / 1000);
  const tps = elapsedS > 0 ? (tokenCount / elapsedS).toFixed(1) : "?";
  process.stdout.write(`\n`);

  if (!translated.trim()) {
    throw new Error(
      `Ollama returned an empty translation for chunk ${chunkIndex + 1}. ` +
        `The model may have hit its context limit or refused the prompt.`
    );
  }

  console.log(
    `[Translator]   Done: ${tokenCount} tokens in ${elapsedS}s (${tps} tok/s), ` +
      `output ${translated.length} chars`
  );
  console.log(`[Translator]   Preview: "${translated.slice(0, 120).replace(/\n/g, " ")}..."`);

  return translated.trim();
}

// ── Public entry point ─────────────────────────────────────────────────────────
export async function translateTranscript(
  text: string,
  sourceLang: string
): Promise<TranslationResult> {
  const langNorm = sourceLang.toLowerCase().trim();

  if (ENGLISH_CODES.has(langNorm)) {
    console.log(`[Translator] Language is already English — skipping translation.`);
    return { translatedText: text, originalText: text, sourceLang, wasTranslated: false };
  }

  const langLabel =
    langNorm === "ur" ? "Urdu"
    : langNorm === "ar" ? "Arabic"
    : langNorm === "fa" ? "Persian/Farsi"
    : langNorm === "hi" ? "Hindi"
    : sourceLang.toUpperCase();

  console.log(`[Translator] Detected language: ${langLabel} (code: "${sourceLang}")`);
  console.log(`[Translator] Input: ${text.length.toLocaleString()} chars, ${text.split(/\s+/).length.toLocaleString()} words`);

  // Verify Ollama is up before spending time on chunking
  await checkOllamaReady();

  const chunks = chunkText(text, CHUNK_SIZE);
  const estSecsPerChunk = 60; // conservative: ~1 min per chunk on M-series
  console.log(
    `[Translator] Split into ${chunks.length} chunk(s) of ~${CHUNK_SIZE} chars each.`
  );
  console.log(
    `[Translator] Rough estimate: ${chunks.length}–${chunks.length * 2} minutes total ` +
      `(${estSecsPerChunk}–${estSecsPerChunk * 2}s per chunk on typical hardware).`
  );

  const translatedChunks: string[] = [];
  const overallStart = Date.now();

  for (let i = 0; i < chunks.length; i++) {
    const chunkStart = Date.now();
    console.log(
      `\n[Translator] ── Chunk ${i + 1}/${chunks.length} ` +
        `(${chunks[i].length} chars) ──`
    );

    let attempt = 0;
    const maxRetries = 3;
    while (true) {
      try {
        attempt++;
        if (attempt > 1) console.log(`[Translator]   Attempt ${attempt}/${maxRetries}...`);
        const result = await translateChunk(chunks[i], langLabel, i, chunks.length);
        translatedChunks.push(result);
        const chunkElapsed = Math.round((Date.now() - chunkStart) / 1000);
        const remaining = chunks.length - i - 1;
        if (remaining > 0) {
          console.log(
            `[Translator]   Chunk ${i + 1} done in ${chunkElapsed}s. ` +
              `~${remaining * chunkElapsed}s remaining (est).`
          );
        }
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n[Translator] ✗ Chunk ${i + 1} attempt ${attempt} FAILED:`);
        console.error(`             ${msg}`);
        if (attempt >= maxRetries) {
          throw new Error(`Translation failed on chunk ${i + 1} after ${maxRetries} attempts: ${msg}`);
        }
        const delay = attempt * 10_000;
        console.log(`[Translator]   Waiting ${delay / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  const translatedText = translatedChunks.join("\n\n");
  const totalElapsed = Math.round((Date.now() - overallStart) / 1000);

  console.log(
    `\n[Translator] ✓ Translation complete in ${totalElapsed}s. ` +
      `${text.length.toLocaleString()} ${langLabel} chars → ${translatedText.length.toLocaleString()} English chars`
  );

  return { translatedText, originalText: text, sourceLang, wasTranslated: true };
}
