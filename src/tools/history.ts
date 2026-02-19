import { createTool } from "@voltagent/core";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { HistoryEntry } from "../types.js";

const HISTORY_PATH = resolve(process.cwd(), "history.json");

function loadHistory(): Record<string, HistoryEntry> {
  if (!existsSync(HISTORY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveHistory(history: Record<string, HistoryEntry>): void {
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}

export const readHistoryTool = createTool({
  name: "read_history",
  description:
    "Read the processed video history. Returns a JSON object mapping video IDs to their processing records.",
  parameters: z.object({}),
  execute: async () => {
    const history = loadHistory();
    return { history, count: Object.keys(history).length };
  },
});

export const checkVideoInHistoryTool = createTool({
  name: "check_video_in_history",
  description: "Check if a specific video ID has already been processed.",
  parameters: z.object({
    videoId: z.string().describe("The YouTube video ID to check"),
  }),
  execute: async ({ videoId }) => {
    const history = loadHistory();
    const exists = videoId in history;
    return { exists, entry: exists ? history[videoId] : null };
  },
});

export const saveToHistoryTool = createTool({
  name: "save_to_history",
  description: "Save a processed video record to the persistent history store.",
  parameters: z.object({
    id: z.string().describe("YouTube video ID"),
    title: z.string().describe("Video title"),
    youtubeUrl: z.string().describe("Full YouTube watch URL"),
    thumbnail: z.string().describe("Thumbnail URL"),
    htmlPath: z.string().describe("Path to generated HTML summary file"),
  }),
  execute: async ({ id, title, youtubeUrl, thumbnail, htmlPath }) => {
    const history = loadHistory();
    const entry: HistoryEntry = {
      id,
      title,
      processedAt: new Date().toISOString(),
      htmlPath,
      youtubeUrl,
      thumbnail,
    };
    history[id] = entry;
    saveHistory(history);
    return { saved: true, entry };
  },
});

export { loadHistory, saveHistory };
