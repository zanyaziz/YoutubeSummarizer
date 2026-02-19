export interface VideoInfo {
  id: string;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number;
  durationString: string;
  channel: string;
  uploadDate?: string;
}

export interface HistoryEntry {
  id: string;
  title: string;
  processedAt: string;
  htmlPath: string;
  youtubeUrl: string;
  thumbnail: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export interface TranslationResult {
  translatedText: string;
  originalText: string;
  sourceLang: string;
  wasTranslated: boolean;
}

export interface AnalysisResult {
  summary: string;
  insights: string[];
}

export interface PipelineResult {
  video: VideoInfo;
  transcript: string;
  analysis: AnalysisResult;
  htmlPath: string;
}
