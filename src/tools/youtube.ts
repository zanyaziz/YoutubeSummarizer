import { createTool } from "@voltagent/core";
import { z } from "zod";
import { execSync, exec, spawn } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { VideoInfo } from "../types.js";

const execAsync = promisify(exec);

// Find yt-dlp in PATH or common conda locations
function getYtDlpPath(): string {
  const candidates = [
    "yt-dlp",
    "/Users/zaziz/miniconda3/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
  ];
  for (const c of candidates) {
    try {
      execSync(`${c} --version`, { stdio: "pipe" });
      return c;
    } catch {
      continue;
    }
  }
  throw new Error("yt-dlp not found. Install with: pip install yt-dlp");
}

const YT_DLP = getYtDlpPath();

export function parseVideoJson(raw: string): VideoInfo {
  const data = JSON.parse(raw);
  return {
    id: data.id,
    url: data.webpage_url || data.url,
    title: data.title || "Untitled",
    description: data.description || "",
    thumbnail:
      data.thumbnail ||
      (data.thumbnails?.length
        ? data.thumbnails[data.thumbnails.length - 1].url
        : ""),
    duration: data.duration || 0,
    durationString: data.duration_string || "",
    channel:
      data.uploader ||
      data.channel ||
      data.playlist_uploader ||
      "Unknown Channel",
    uploadDate: data.upload_date,
  };
}

export const getLatestVideoTool = createTool({
  name: "get_latest_video",
  description:
    "Fetch metadata for the most recently uploaded video from a YouTube channel URL.",
  parameters: z.object({
    channelUrl: z.string().describe("YouTube channel URL"),
  }),
  execute: async ({ channelUrl }) => {
    const cmd = `${YT_DLP} --flat-playlist --playlist-items 1 -j "${channelUrl}/videos" 2>/dev/null`;
    const { stdout } = await execAsync(cmd, { timeout: 60_000 });
    const line = stdout.trim().split("\n")[0];
    if (!line) throw new Error("No videos found on channel");
    const data = JSON.parse(line);

    // Fetch full video metadata using the video ID
    const videoUrl = `https://www.youtube.com/watch?v=${data.id}`;
    const { stdout: fullJson } = await execAsync(
      `${YT_DLP} -j "${videoUrl}" 2>/dev/null`,
      { timeout: 60_000 }
    );
    const video = parseVideoJson(fullJson.trim());
    return video;
  },
});

export const downloadAudioTool = createTool({
  name: "download_audio",
  description:
    "Download audio from a YouTube video using yt-dlp. Returns the path to the downloaded audio file.",
  parameters: z.object({
    videoId: z.string().describe("YouTube video ID"),
    outputDir: z.string().describe("Directory to save the audio file"),
  }),
  execute: async ({ videoId, outputDir }) => {
    const absOutput = resolve(process.cwd(), outputDir);
    if (!existsSync(absOutput)) mkdirSync(absOutput, { recursive: true });

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputTemplate = resolve(absOutput, `${videoId}.%(ext)s`);
    const audioPath = resolve(absOutput, `${videoId}.mp3`);

    // Skip download if mp3 already exists
    if (existsSync(audioPath)) {
      console.log(`[Youtube] Audio already cached: ${audioPath}`);
      return { audioPath, videoId };
    }

    console.log(`[Youtube] Downloading audio for video: ${videoId}`);
    console.log(`[Youtube] Output: ${audioPath}`);

    await new Promise<void>((resolve, reject) => {
      const args = [
        // Use android player client to bypass YouTube's SABR streaming restrictions
        "--extractor-args", "youtube:player_client=android",
        "-x", "--audio-format", "mp3", "--audio-quality", "0",
        "--newline", // one progress line per update (no \r overwriting)
        "-o", outputTemplate,
        videoUrl,
      ];
      // Inherit stdio so yt-dlp progress streams directly to the console
      const proc = spawn(YT_DLP, args, { stdio: ["ignore", "inherit", "inherit"] });

      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
      proc.on("error", (err) => reject(new Error(`yt-dlp spawn failed: ${err.message}`)));
    });

    if (!existsSync(audioPath)) {
      throw new Error(`Audio file not created at expected path: ${audioPath}`);
    }

    return { audioPath, videoId };
  },
});
