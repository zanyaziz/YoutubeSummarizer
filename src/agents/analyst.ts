/**
 * Analyst Agent — uses local Ollama (native REST API) to generate
 * a summary and top insights from the full transcript text.
 * Uses the native /api/generate endpoint directly to avoid SDK timeout issues.
 */
import type { AnalysisResult } from "../types.js";

const OLLAMA_BASE = "http://localhost:11434";
const OLLAMA_MODEL = "llama3.2";
const OLLAMA_TIMEOUT_MS = 300_000; // 5 minutes per Ollama call

const MAX_TRANSCRIPT_CHARS = 10_000; // Keep within llama3.2 context window

function truncateTranscript(transcript: string): string {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) return transcript;
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return (
    transcript.slice(0, half) +
    "\n\n[... transcript truncated for context window ...]\n\n" +
    transcript.slice(-half)
  );
}

async function callOllamaNative(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: true,
        // num_ctx: keep to 16384 — the truncated transcript fits comfortably
        // and avoids the 131072-default CPU-offload penalty.
        options: { temperature: 0.3, num_predict: 1024, num_ctx: 16384 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    if (!response.body) throw new Error("Ollama response has no body");

    console.log(`[Analyst] Receiving streamed response from Ollama (${OLLAMA_MODEL})...`);

    let fullResponse = "";
    let tokenCount = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as { response: string; done: boolean };
          fullResponse += chunk.response;
          tokenCount++;
          // Print a dot every 10 tokens as a live heartbeat
          if (tokenCount % 10 === 0) {
            process.stdout.write(".");
          }
          if (chunk.done) break;
        } catch {
          // skip malformed lines
        }
      }
    }

    // End the dot-progress line
    if (tokenCount > 0) process.stdout.write(`\n`);
    console.log(`[Analyst] Response complete (${tokenCount} tokens).`);
    return fullResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOllamaWithRetry(
  prompt: string,
  maxRetries = 3
): Promise<string> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `[Analyst] Calling Ollama (${OLLAMA_MODEL}), attempt ${attempt}/${maxRetries}...`
      );
      const text = await callOllamaNative(prompt);
      return text;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[Analyst] Ollama attempt ${attempt} failed: ${lastError.message}`
      );
      if (attempt < maxRetries) {
        const delay = attempt * 5000;
        console.log(`[Analyst] Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(
    `Ollama failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}

function parseAnalysisJson(raw: string): AnalysisResult {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found");

  const jsonStr = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(jsonStr);

  if (typeof parsed.summary !== "string")
    throw new Error("Missing 'summary' field");
  if (!Array.isArray(parsed.insights))
    throw new Error("Missing 'insights' array");

  return {
    summary: parsed.summary.trim(),
    insights: parsed.insights
      .map((s: unknown) => String(s).trim())
      .filter(Boolean),
  };
}

export async function analyzeTranscript(
  transcript: string,
  videoTitle: string
): Promise<AnalysisResult> {
  console.log(`[Analyst] Analyzing transcript for: "${videoTitle}"`);

  const truncated = truncateTranscript(transcript);

  const prompt = `You are analyzing the transcript of a video titled: "${videoTitle}"

TRANSCRIPT:
${truncated}

Provide a JSON response with:
1. "summary": A concise 3-5 sentence summary of the key message.
2. "insights": An array of exactly 10 key ideas or insights from the content.

Output ONLY valid JSON, no markdown code blocks. Example:
{"summary": "This video discusses...", "insights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5", "insight 6", "insight 7", "insight 8", "insight 9", "insight 10"]}`;

  const rawResponse = await callOllamaWithRetry(prompt);

  try {
    const result = parseAnalysisJson(rawResponse);
    console.log(
      `[Analyst] Analysis complete. Summary length: ${result.summary.length} chars, insights: ${result.insights.length}`
    );
    return result;
  } catch (parseErr: unknown) {
    console.warn(
      "[Analyst] JSON parse failed, using fallback:",
      String(parseErr)
    );
    return {
      summary: rawResponse.slice(0, 800).trim(),
      insights: [
        "Analysis extraction failed — see full transcript for details.",
      ],
    };
  }
}
