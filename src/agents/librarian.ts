/**
 * Librarian Agent — generates styled HTML pages and maintains the library index.
 */
import { generateSummaryHtmlTool } from "../tools/html.js";
import { updateIndexHtmlTool } from "../tools/html.js";
import { saveToHistoryTool } from "../tools/history.js";
import type { VideoInfo, AnalysisResult } from "../types.js";
import { resolve } from "path";

export async function publishToLibrary(
  video: VideoInfo,
  transcript: string,
  analysis: AnalysisResult,
  language: string,
  originalTranscript?: string,
  sourceLang?: string
): Promise<string> {
  console.log(`[Librarian] Generating HTML for: "${video.title}"`);
  if (originalTranscript) {
    console.log(`[Librarian] Including original ${sourceLang ?? language} transcript alongside English translation.`);
  }

  const date = new Date().toISOString().split("T")[0];

  // Generate the individual video summary page
  const htmlResult = await generateSummaryHtmlTool.execute(
    {
      videoId: video.id,
      videoTitle: video.title,
      videoUrl: video.url,
      thumbnail: video.thumbnail,
      channel: video.channel,
      durationString: video.durationString,
      transcript,
      originalTranscript,
      sourceLang,
      summary: analysis.summary,
      insights: analysis.insights,
      language,
      date,
    },
    {} as never
  ) as { filePath: string; fileName: string };

  console.log(`[Librarian] HTML saved: ${htmlResult.filePath}`);

  // Save to history
  await saveToHistoryTool.execute(
    {
      id: video.id,
      title: video.title,
      youtubeUrl: video.url,
      thumbnail: video.thumbnail,
      htmlPath: htmlResult.filePath,
    },
    {} as never
  );

  // Rebuild the index page
  await updateIndexHtmlTool.execute({}, {} as never);
  console.log(`[Librarian] Index page updated.`);

  return htmlResult.filePath;
}
