/**
 * Watchman Agent — monitors a YouTube channel for new videos.
 */
import { getLatestVideoTool } from "../tools/youtube.js";
import { checkVideoInHistoryTool } from "../tools/history.js";
import type { VideoInfo } from "../types.js";

export async function checkForNewVideo(
  channelUrl: string
): Promise<VideoInfo | null> {
  console.log(`[Watchman] Checking channel: ${channelUrl}`);

  const latest = (await getLatestVideoTool.execute(
    { channelUrl },
    {} as never
  )) as VideoInfo;

  const historyCheck = (await checkVideoInHistoryTool.execute(
    { videoId: latest.id },
    {} as never
  )) as { exists: boolean };

  if (historyCheck.exists) {
    console.log(
      `[Watchman] Video ${latest.id} already processed. No new video.`
    );
    return null;
  }

  console.log(
    `[Watchman] ✓ New video detected: "${latest.title}" (${latest.id})`
  );
  return latest;
}
