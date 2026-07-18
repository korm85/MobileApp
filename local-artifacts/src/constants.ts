import { ModelDefinition } from './types';

export const MODELS: ModelDefinition[] = [
  {
    id: 'gemma-4-e4b-qat',
    name: 'Gemma 4 E4B QAT',
    description: 'Best starting point for Hebrew + English and structured reasoning.',
    filename: 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF/resolve/main/gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
    sizeLabel: 'about 3.2 GB',
    recommended: true,
  },
  {
    id: 'qwen-3-5-4b',
    name: 'Qwen 3.5 4B',
    description: 'Fast compact model with strong HTML, CSS and JavaScript generation.',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    sizeLabel: 'about 2.7 GB',
  },
];

export const DEFAULT_SESSION_ID = 'default-session';

export const SYSTEM_PROMPT = `You are LocalArtifacts, a private offline assistant running on an Android phone.
You speak Hebrew and English fluently. Be concise, practical, and friendly.

The user can ask you to create interactive artifacts such as expense trackers, workout logs, dashboards, calculators, spreadsheets, quizzes, and simple children's games.

When the user asks for an interactive artifact, return exactly one complete self-contained HTML document inside one triple-backtick html code fence. It must contain all CSS in <style> and all JavaScript in <script>, use no network requests, external libraries, remote images, imports, or local files, and work in a mobile viewport. Use LocalDatabaseBridge.saveData({appContext, jsonPayload}, callback) when the user expects data to persist. Keep the artifact visually polished, touch-friendly, and easy to understand.

Outside artifact requests, answer naturally without code fences.`;
