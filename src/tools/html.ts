import { createTool } from "@voltagent/core";
import { z } from "zod";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import type { HistoryEntry } from "../types.js";
import { loadHistory } from "./history.js";

const LIBRARY_DIR = resolve(process.cwd(), "library");

function ensureLibraryDir(): void {
  if (!existsSync(LIBRARY_DIR)) mkdirSync(LIBRARY_DIR, { recursive: true });
}

export const generateSummaryHtmlTool = createTool({
  name: "generate_summary_html",
  description:
    "Generate a styled HTML summary page for a video with its transcript, summary, and insights. Returns the file path.",
  parameters: z.object({
    videoId: z.string(),
    videoTitle: z.string(),
    videoUrl: z.string(),
    thumbnail: z.string(),
    channel: z.string(),
    durationString: z.string(),
    transcript: z.string().describe("English transcript (translated if needed)"),
    originalTranscript: z.string().optional().describe("Original non-English transcript, if translation occurred"),
    sourceLang: z.string().optional().describe("Original language label, e.g. 'Urdu'"),
    summary: z.string(),
    insights: z.array(z.string()),
    language: z.string().default("unknown"),
    date: z.string().describe("Date string in YYYY-MM-DD format"),
  }),
  execute: async ({
    videoId,
    videoTitle,
    videoUrl,
    thumbnail,
    channel,
    durationString,
    transcript,
    originalTranscript,
    sourceLang,
    summary,
    insights,
    language,
    date,
  }) => {
    ensureLibraryDir();
    const fileName = `${date}_${videoId}.html`;
    const filePath = resolve(LIBRARY_DIR, fileName);

    const insightItems = insights
      .map(
        (item, i) => `
        <li class="flex gap-3 p-3 bg-slate-800 rounded-lg">
          <span class="flex-shrink-0 w-7 h-7 bg-red-600 text-white text-sm font-bold rounded-full flex items-center justify-center">${i + 1}</span>
          <span class="text-slate-200">${escapeHtml(item)}</span>
        </li>`
      )
      .join("\n");

    const escapedTranscript = escapeHtml(transcript);
    const escapedSummary = escapeHtml(summary);
    const escapedTitle = escapeHtml(videoTitle);
    const sourceLangLabel = sourceLang ?? language.toUpperCase();

    const originalTranscriptSection = originalTranscript
      ? `
    <!-- Original Language Transcript -->
    <section class="mb-8 bg-slate-800 rounded-2xl p-6 border border-slate-700">
      <h2 class="text-xl font-bold text-amber-400 mb-1">📜 Original Transcript <span class="text-sm font-normal text-slate-400">(${escapeHtml(sourceLangLabel)})</span></h2>
      <p class="text-xs text-slate-500 mb-4">Verbatim transcription before translation.</p>
      <div class="transcript-container h-64 overflow-y-auto bg-slate-900 rounded-xl p-4 text-slate-300 border border-slate-700" dir="rtl">
${escapeHtml(originalTranscript)}
      </div>
    </section>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle} | YT Sentinel</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; }
    .transcript-container { white-space: pre-wrap; font-size: 0.9rem; line-height: 1.75; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen">
  <div class="max-w-5xl mx-auto px-4 py-10">

    <!-- Header -->
    <div class="mb-8">
      <a href="index.html" class="text-red-400 hover:text-red-300 text-sm mb-4 inline-flex items-center gap-1">
        ← Back to Library
      </a>
      <h1 class="text-2xl md:text-3xl font-bold mt-3 text-white leading-snug">${escapedTitle}</h1>
      <div class="flex flex-wrap gap-4 mt-3 text-slate-400 text-sm">
        <span>📺 ${escapeHtml(channel)}</span>
        <span>⏱ ${escapeHtml(durationString)}</span>
        <span>🌐 ${language.toUpperCase()}</span>
        <span>📅 ${date}</span>
      </div>
    </div>

    <!-- Thumbnail + Links -->
    <div class="mb-8 flex flex-col sm:flex-row gap-6 items-start">
      <a href="${videoUrl}" target="_blank" rel="noopener" class="flex-shrink-0">
        <img src="${thumbnail}" alt="Video thumbnail" class="w-full sm:w-72 rounded-xl shadow-lg border border-slate-700 hover:opacity-90 transition" />
      </a>
      <div class="flex flex-col gap-3 justify-center">
        <a href="${videoUrl}" target="_blank" rel="noopener"
           class="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-semibold px-5 py-3 rounded-lg transition">
          ▶ Watch on YouTube
        </a>
        <p class="text-slate-400 text-sm">Processed by YT-Channel-Sentinel · Local Whisper + Ollama</p>
      </div>
    </div>

    <!-- Summary -->
    <section class="mb-8 bg-slate-800 rounded-2xl p-6 border border-slate-700">
      <h2 class="text-xl font-bold text-red-400 mb-4">📝 Summary</h2>
      <p class="text-slate-200 leading-relaxed">${escapedSummary}</p>
    </section>

    <!-- Top 10 Insights -->
    <section class="mb-8 bg-slate-800 rounded-2xl p-6 border border-slate-700">
      <h2 class="text-xl font-bold text-red-400 mb-4">💡 Top ${insights.length} Ideas & Insights</h2>
      <ol class="space-y-3">
        ${insightItems}
      </ol>
    </section>

    ${originalTranscriptSection}

    <!-- Full Transcript (English) -->
    <section class="mb-8 bg-slate-800 rounded-2xl p-6 border border-slate-700">
      <h2 class="text-xl font-bold text-red-400 mb-1">📃 Full Transcript <span class="text-sm font-normal text-slate-400">${originalTranscript ? "(English Translation)" : "(Verbatim)"}</span></h2>
      ${originalTranscript ? `<p class="text-xs text-slate-500 mb-4">Machine-translated from ${escapeHtml(sourceLangLabel)} using local Ollama.</p>` : ""}
      <div class="transcript-container h-96 overflow-y-auto bg-slate-900 rounded-xl p-4 text-slate-300 border border-slate-700">
${escapedTranscript}
      </div>
    </section>

    <!-- Footer -->
    <footer class="text-center text-slate-600 text-sm pt-4 border-t border-slate-800">
      Generated by YT-Channel-Sentinel · ${new Date().toUTCString()}
    </footer>
  </div>
</body>
</html>`;

    writeFileSync(filePath, html, "utf-8");
    return { filePath, fileName };
  },
});

export const updateIndexHtmlTool = createTool({
  name: "update_index_html",
  description:
    "Regenerate the library/index.html landing page with links to all processed videos.",
  parameters: z.object({}),
  execute: async () => {
    ensureLibraryDir();
    const history = loadHistory();
    const entries = Object.values(history).sort(
      (a, b) =>
        new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime()
    );

    const cards = entries
      .map((entry) => {
        const date = entry.processedAt.split("T")[0];
        const htmlFile = basename(entry.htmlPath);
        return `
      <a href="${htmlFile}" class="block bg-slate-800 rounded-2xl overflow-hidden border border-slate-700 hover:border-red-500 transition group">
        <div class="relative">
          <img src="${entry.thumbnail}" alt="${escapeHtml(entry.title)}" class="w-full h-48 object-cover group-hover:opacity-90 transition" />
          <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent"></div>
        </div>
        <div class="p-4">
          <h3 class="font-semibold text-white group-hover:text-red-400 transition line-clamp-2 mb-2">${escapeHtml(entry.title)}</h3>
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>📅 ${date}</span>
            <a href="${entry.youtubeUrl}" target="_blank" rel="noopener"
               class="text-red-400 hover:text-red-300 font-medium" onclick="event.stopPropagation()">
              ▶ YouTube
            </a>
          </div>
        </div>
      </a>`;
      })
      .join("\n");

    const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>YT-Channel-Sentinel Library</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    body { font-family: 'Inter', system-ui, sans-serif; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen">
  <div class="max-w-6xl mx-auto px-4 py-10">
    <header class="mb-10 text-center">
      <h1 class="text-4xl font-extrabold text-white mb-2">
        📡 YT-Channel-Sentinel
      </h1>
      <p class="text-slate-400 text-lg">Knowledge library — powered by local Whisper + Ollama</p>
      <p class="text-slate-500 text-sm mt-1">${entries.length} video${entries.length !== 1 ? "s" : ""} processed</p>
    </header>

    ${
      entries.length === 0
        ? `<div class="text-center text-slate-500 py-20">
          <p class="text-6xl mb-4">🎬</p>
          <p class="text-xl">No videos processed yet.</p>
          <p class="text-sm mt-2">Run the sentinel to start building your library.</p>
        </div>`
        : `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">${cards}</div>`
    }

    <footer class="text-center text-slate-600 text-sm pt-10 border-t border-slate-800 mt-10">
      Last updated: ${new Date().toUTCString()} · YT-Channel-Sentinel
    </footer>
  </div>
</body>
</html>`;

    const indexPath = resolve(LIBRARY_DIR, "index.html");
    writeFileSync(indexPath, html, "utf-8");
    return { indexPath, totalVideos: entries.length };
  },
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
