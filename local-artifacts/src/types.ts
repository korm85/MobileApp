export type Sender = 'user' | 'assistant';

export type Message = {
  id: string;
  sessionId: string;
  sender: Sender;
  content: string;
  createdAt: number;
};

export type Artifact = {
  id: string;
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
  recommended?: boolean;
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
