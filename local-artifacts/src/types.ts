export type Sender = 'user' | 'assistant';
export type ResponseMode = 'chat' | 'canvas' | 'auto';

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  webSearchEnabled: boolean;
  webSearchDepth: 'basic' | 'advanced';
  showThinking: boolean;
  thinkingEnabled: boolean;
};

export type MediaAttachment = {
  id: string;
  kind: 'image' | 'audio';
  uri: string;
  mimeType: string;
  name: string;
  size?: number;
};

export type Message = {
  id: string;
  sessionId: string;
  sender: Sender;
  content: string;
  createdAt: number;
  attachments?: MediaAttachment[];
};

export type Artifact = {
  id: string;
  sessionId: string;
  title: string;
  html: string;
  createdAt: number;
  sourceMessageId?: string;
};

export type ModelStatus = 'not-downloaded' | 'downloading' | 'ready' | 'loading' | 'loaded' | 'error';

export type ModelDefinition = {
  id: string;
  name: string;
  description: string;
  filename: string;
  url: string;
  sizeLabel: string;
  mmprojFilename?: string;
  mmprojUrl?: string;
  mmprojSizeLabel?: string;
  mtpFilename?: string;
  mtpUrl?: string;
  mtpSizeLabel?: string;
  recommended?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  supportsAudio?: boolean;
  supportsMtp?: boolean;
  custom?: boolean;
};

export type ModelState = Record<string, {
  status: ModelStatus;
  progress: number;
  error?: string;
}>;

export type GenerationSettings = {
  systemPrompt: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextSize: number;
  threads: number;
  gpuLayers: number;
  showThinking: boolean;
  responseMode: ResponseMode;
  webSearchEnabled: boolean;
  webSearchDepth: 'basic' | 'advanced';
};

export type AppTheme = {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  userBubble: string;
  assistantBubble: string;
  danger: string;
};
