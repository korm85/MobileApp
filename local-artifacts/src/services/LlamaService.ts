import { initLlama, LlamaContext } from 'llama.rn';
import { ARTIFACT_MODE_INSTRUCTIONS, SYSTEM_PROMPT } from '../constants';
import { ChatSession, GenerationSettings } from '../types';

type ChatControls = Pick<ChatSession, 'showThinking' | 'thinkingEnabled'>;

export type InferenceOptions = {
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;
};

export class LlamaService {
  private static instance: LlamaService;
  private context: LlamaContext | null = null;
  private initializing = false;
  private loadedPath: string | null = null;
  private loadedConfigKey: string | null = null;

  static getInstance() {
    if (!LlamaService.instance) LlamaService.instance = new LlamaService();
    return LlamaService.instance;
  }

  async initialize(modelPath: string, options: InferenceOptions = {}) {
    const configKey = `${modelPath}|${options.contextSize ?? 2048}|${options.threads ?? 4}|${options.gpuLayers ?? 0}`;
    if (this.context && this.loadedConfigKey === configKey) return;
    if (this.initializing) throw new Error('The model is already loading');
    this.initializing = true;
    try {
      if (this.context) await this.context.release();
      // Pixel 10a uses Mali. llama.rn documents OpenCL support for Qualcomm Adreno,
      // so CPU is the safe default here. Keep gpuLayers configurable for other devices.
      this.context = await initLlama({
        model: modelPath,
        n_ctx: options.contextSize ?? 2048,
        n_threads: options.threads ?? 4,
        n_gpu_layers: options.gpuLayers ?? 0,
        use_mlock: false,
      });
      this.loadedPath = modelPath;
      this.loadedConfigKey = configKey;
    } finally {
      this.initializing = false;
    }
  }

  isLoaded() {
    return Boolean(this.context);
  }

  async generateResponse(
    userPrompt: string,
    onToken: (token: string) => void,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    settings: GenerationSettings,
    chatControls: ChatControls,
  ) {
    if (!this.context) throw new Error('Load a local model before chatting.');
    const result = await this.context.completion({
      messages: [
        { role: 'system', content: `${settings.systemPrompt.trim() || SYSTEM_PROMPT}\n\n${ARTIFACT_MODE_INSTRUCTIONS}\n\nCURRENT RESPONSE MODE: ${settings.responseMode.toUpperCase()}
THINKING MODE: ${chatControls.thinkingEnabled ? 'ON — reason before answering' : 'OFF — answer directly'}
THINKING VISIBILITY: ${chatControls.showThinking ? 'SHOW' : 'HIDE'}
` },
        ...history,
        { role: 'user', content: userPrompt },
      ],
      temperature: settings.temperature,
      top_p: settings.topP,
      n_predict: settings.maxTokens,
      chat_template_kwargs: {
        enable_thinking: chatControls.thinkingEnabled,
        preserve_thinking: chatControls.showThinking,
      },
      stop: ['<|im_end|>', '</s>'],
    }, (data) => onToken(data.token));
    return result.text;
  }

  async stopGeneration() {
    if (this.context) await this.context.stopCompletion();
  }

  async release() {
    if (this.context) await this.context.release();
    this.context = null;
    this.loadedPath = null;
    this.loadedConfigKey = null;
  }
}
