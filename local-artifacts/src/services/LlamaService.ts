import { initLlama, LlamaContext } from 'llama.rn';
import { SYSTEM_PROMPT } from '../constants';

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

  static getInstance() {
    if (!LlamaService.instance) LlamaService.instance = new LlamaService();
    return LlamaService.instance;
  }

  async initialize(modelPath: string, options: InferenceOptions = {}) {
    if (this.context && this.loadedPath === modelPath) return;
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
  ) {
    if (!this.context) throw new Error('Load a local model before chatting.');
    const result = await this.context.completion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      top_p: 0.9,
      n_predict: 1200,
      stop: ['<|im_end|>', '</s>'],
    }, (data) => onToken(data.token));
    return result.text;
  }

  async release() {
    if (this.context) await this.context.release();
    this.context = null;
    this.loadedPath = null;
  }
}
