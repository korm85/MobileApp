import {initLlama, type LlamaContext} from 'llama.rn';

let context: LlamaContext | null = null;

export async function loadLocalModel(path: string, onProgress: (value: number) => void) {
  if (context) await context.release();
  context = await initLlama({
    model: path,
    n_ctx: 4096,
    n_threads: 4,
    n_gpu_layers: 0,
    flash_attn: false,
  }, onProgress);
}

export async function askLocalModel(prompt: string, onToken: (token: string) => void) {
  if (!context) throw new Error('Choose your GGUF model first.');
  return context.completion({
    prompt,
    n_predict: 700,
    temperature: 0.7,
    top_p: 0.9,
    stop: ['<|im_end|>', '<|eot_id|>'],
  }, data => onToken(data.token));
}

export async function stopLocalModel() { await context?.stopCompletion(); }
