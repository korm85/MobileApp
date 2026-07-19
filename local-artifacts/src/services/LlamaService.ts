import { initLlama, LlamaContext } from 'llama.rn';
import { ARTIFACT_MODE_INSTRUCTIONS, SYSTEM_PROMPT } from '../constants';
import { ChatSession, GenerationSettings, MediaAttachment } from '../types';

type ChatControls = Pick<ChatSession, 'showThinking' | 'thinkingEnabled'>;
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: any };

export type InferenceOptions = {
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;
  mmprojPath?: string;
  draftPath?: string;
};

function mediaMessageContent(text: string, attachments: MediaAttachment[]) {
  const parts: any[] = [{ type: 'text', text }];
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: attachment.uri } });
    } else {
      const format = attachment.mimeType.includes('mpeg') || attachment.name.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav';
      parts.push({ type: 'input_audio', input_audio: { url: attachment.uri, format } });
    }
  }
  return parts;
}

function messageContent(message: { content: string; attachments?: MediaAttachment[] }) {
  return message.attachments?.length ? mediaMessageContent(message.content, message.attachments) : message.content;
}

export class LlamaService {
  private static instance: LlamaService;
  private context: LlamaContext | null = null;
  private initializing = false;
  private loadedConfigKey: string | null = null;
  private multimodalEnabled = false;
  private mtpEnabled = false;

  static getInstance() {
    if (!LlamaService.instance) LlamaService.instance = new LlamaService();
    return LlamaService.instance;
  }

  async initialize(modelPath: string, options: InferenceOptions = {}) {
    const configKey = [modelPath, options.mmprojPath || '', options.draftPath || '', options.contextSize ?? 2048, options.threads ?? 4, options.gpuLayers ?? 0].join('|');
    if (this.context && this.loadedConfigKey === configKey) return;
    if (this.initializing) throw new Error('The model is already loading');
    this.initializing = true;
    try {
      if (this.context) {
        if (this.multimodalEnabled) await this.context.releaseMultimodal().catch(() => undefined);
        await this.context.release();
      }
      this.multimodalEnabled = false;
      this.mtpEnabled = Boolean(options.draftPath);
      this.context = await initLlama({
        model: modelPath,
        model_draft: options.draftPath,
        n_ctx: options.contextSize ?? 2048,
        n_threads: options.threads ?? 4,
        n_gpu_layers: options.gpuLayers ?? 0,
        use_mlock: false,
        ctx_shift: Boolean(options.mmprojPath) ? false : undefined,
        speculative: options.draftPath ? { type: 'draft-mtp', n_max: 3 } : undefined,
      });
      if (options.mmprojPath) {
        this.multimodalEnabled = await this.context.initMultimodal({
          path: options.mmprojPath,
          use_gpu: (options.gpuLayers ?? 0) > 0,
          image_max_tokens: 512,
        });
        if (!this.multimodalEnabled) throw new Error('The model loaded, but its vision/audio projector could not be initialized.');
      }
      this.loadedConfigKey = configKey;
    } finally {
      this.initializing = false;
    }
  }

  isLoaded() {
    return Boolean(this.context);
  }

  hasMultimodal() {
    return this.multimodalEnabled;
  }

  hasMtp() {
    return this.mtpEnabled;
  }

  async generateResponse(
    userPrompt: string,
    onToken: (token: string) => void,
    history: ChatMessage[] = [],
    settings: GenerationSettings,
    chatControls: ChatControls,
    attachments: MediaAttachment[] = [],
  ) {
    if (!this.context) throw new Error('Load a local model before chatting.');
    if (attachments.length && !this.multimodalEnabled) throw new Error('This model is not loaded with its multimodal projector.');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: (settings.systemPrompt.trim() || SYSTEM_PROMPT) + '\n\n' + ARTIFACT_MODE_INSTRUCTIONS + '\n\nCURRENT RESPONSE MODE: ' + settings.responseMode.toUpperCase() + '\n' +
          'THINKING MODE: ' + (chatControls.thinkingEnabled ? 'ON — reason before answering' : 'OFF — answer directly') + '\n' +
          'THINKING VISIBILITY: ' + (chatControls.showThinking ? 'SHOW' : 'HIDE') + '\n',
      },
      ...history,
      { role: 'user', content: attachments.length ? mediaMessageContent(userPrompt, attachments) : userPrompt },
    ];
    const result = await this.context.completion({
      messages: messages as any,
      temperature: settings.temperature,
      top_p: settings.topP,
      n_predict: settings.maxTokens,
      chat_template_kwargs: {
        enable_thinking: chatControls.thinkingEnabled,
        preserve_thinking: chatControls.showThinking,
      },
      speculative: attachments.length || !this.mtpEnabled ? false : { type: 'draft-mtp', n_max: 3 },
      stop: ['<|im_end|>', '</s>'],
    } as any, (data) => onToken(data.token));
    return result.text;
  }

  async stopGeneration() {
    if (this.context) await this.context.stopCompletion();
  }

  async release() {
    if (this.context) {
      if (this.multimodalEnabled) await this.context.releaseMultimodal().catch(() => undefined);
      await this.context.release();
    }
    this.context = null;
    this.loadedConfigKey = null;
    this.multimodalEnabled = false;
    this.mtpEnabled = false;
  }
}
