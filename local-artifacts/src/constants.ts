import { ModelDefinition } from './types';

export const DEFAULT_CHAT_CONTROLS = {
  webSearchEnabled: false,
  webSearchDepth: 'basic',
  showThinking: false,
  thinkingEnabled: false,
} as const;

const UNSLOTH_E2B = 'https://huggingface.co/unsloth/gemma-4-E2B-it-qat-GGUF/resolve/main/';
const UNSLOTH_E4B = 'https://huggingface.co/unsloth/gemma-4-E4B-it-qat-GGUF/resolve/main/';

export const MODELS: ModelDefinition[] = [
  {
    id: 'gemma-4-e2b-qat',
    name: 'Gemma 4 E2B QAT · best mobile balance',
    description: 'Unsloth Dynamic 2.0 QAT GGUF with vision, audio and optional MTP acceleration for on-device chat.',
    filename: 'gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf',
    url: UNSLOTH_E2B + 'gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf',
    sizeLabel: '2.62 GB',
    mmprojFilename: 'mmproj-BF16.gguf',
    mmprojUrl: UNSLOTH_E2B + 'mmproj-BF16.gguf',
    mmprojSizeLabel: '987 MB vision/audio projector',
    mtpFilename: 'mtp-gemma-4-E2B-it.gguf',
    mtpUrl: UNSLOTH_E2B + 'mtp-gemma-4-E2B-it.gguf',
    mtpSizeLabel: '59 MB MTP speed-up',
    recommended: true,
    supportsThinking: true,
    supportsVision: true,
    supportsAudio: true,
    supportsMtp: true,
  },
  {
    id: 'gemma-4-e4b-qat',
    name: 'Gemma 4 E4B QAT',
    description: 'Larger Unsloth Dynamic 2.0 QAT model with vision, audio and optional MTP acceleration.',
    filename: 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
    url: UNSLOTH_E4B + 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
    sizeLabel: '4.22 GB',
    mmprojFilename: 'mmproj-BF16.gguf',
    mmprojUrl: UNSLOTH_E4B + 'mmproj-BF16.gguf',
    mmprojSizeLabel: '992 MB vision/audio projector',
    mtpFilename: 'mtp-gemma-4-E4B-it.gguf',
    mtpUrl: UNSLOTH_E4B + 'mtp-gemma-4-E4B-it.gguf',
    mtpSizeLabel: '60 MB MTP speed-up',
    supportsThinking: true,
    supportsVision: true,
    supportsAudio: true,
    supportsMtp: true,
  },
  {
    id: 'qwen-3-5-4b',
    name: 'Qwen 3.5 4B',
    description: 'Fast compact model with strong HTML, CSS and JavaScript generation.',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    sizeLabel: 'about 2.7 GB',
    supportsThinking: false,
  },
];

export const DEFAULT_SESSION_ID = 'default-session';

export const DEFAULT_GENERATION_SETTINGS = {
  systemPrompt: '',
  temperature: 0.2,
  topP: 0.9,
  maxTokens: 1200,
  contextSize: 2048,
  threads: 4,
  gpuLayers: 0,
  showThinking: false,
  responseMode: 'auto',
  webSearchEnabled: false,
  webSearchDepth: 'basic',
} as const;

export const SYSTEM_PROMPT = `You are PocketMind, a private assistant running on an Android phone.
You speak Hebrew and English fluently. Be concise, practical, and friendly.

The user can ask you to create interactive artifacts such as expense trackers, workout logs, dashboards, calculators, spreadsheets, quizzes, and simple children's games.

When the user asks for an interactive artifact, use the PocketMind artifact protocol described in the mode instructions. Do not return an artifact as a Markdown code fence. Use LocalDatabaseBridge.saveData({appContext, jsonPayload}, callback) when the user expects data to persist. Keep the artifact visually polished, touch-friendly, and easy to understand.

When web-search context is included in the user message, use it as the source of current information. Do not claim to have searched unless that context is present. Cite sources using [1], [2], etc. matching the supplied source list.

Outside artifact requests, answer naturally without code fences.`;

export const ARTIFACT_MODE_INSTRUCTIONS = `
ARTIFACT PROTOCOL:
When response mode is CANVAS, return one complete self-contained HTML document using exactly this envelope:
<pm-artifact title="Short title">
<!doctype html>...</html>
</pm-artifact>
Do not use Markdown fences around it. The application opens the Canvas only after the closing </pm-artifact> marker is received.
The artifact runs offline. Do not use network requests, imports, CDNs, remote images, or local file paths.
Default local libraries are already available as globals when useful: THREE, echarts, d3, marked, DOMPurify, Prism, katex, Papa, JSZip, Dexie, Fuse, and Tweakpane. Use them without imports.
When response mode is CHAT, never emit the artifact envelope. When response mode is AUTO, emit the envelope only when the user clearly asks to create or build an interactive visual artifact.`;
