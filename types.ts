
export interface AnalysisResult {
  answer: string;
  groundingMetadata?: any;
}

export interface BoundingBox {
  name: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export enum AppState {
  UPLOAD = 'UPLOAD',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  ANALYZING = 'ANALYZING',
  RESULT = 'RESULT',
  ERROR = 'ERROR'
}
