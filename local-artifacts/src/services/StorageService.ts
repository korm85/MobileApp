import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';
import { Artifact, ChatSession, GenerationSettings, Message, ModelDefinition } from '../types';
import { DEFAULT_GENERATION_SETTINGS } from '../constants';

const SETTINGS_KEY = 'generation-settings-v1';
const TAVILY_API_KEY = 'tavily-api-key-v1';
const ACTIVE_SESSION_KEY = 'active-session-v1';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb() {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('local_artifacts.db');
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      web_search_enabled INTEGER NOT NULL DEFAULT 0,
      web_search_depth TEXT NOT NULL DEFAULT 'basic',
      show_thinking INTEGER NOT NULL DEFAULT 0,
      thinking_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      html TEXT NOT NULL,
      source_message_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_context TEXT NOT NULL,
      json_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  try { await db.execAsync('ALTER TABLE artifacts ADD COLUMN session_id TEXT'); } catch { /* Existing installs already have the column. */ }
  for (const statement of [
    'ALTER TABLE sessions ADD COLUMN web_search_enabled INTEGER NOT NULL DEFAULT 0',
    \"ALTER TABLE sessions ADD COLUMN web_search_depth TEXT NOT NULL DEFAULT 'basic'\",
    'ALTER TABLE sessions ADD COLUMN show_thinking INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE sessions ADD COLUMN thinking_enabled INTEGER NOT NULL DEFAULT 0',
  ]) { try { await db.execAsync(statement); } catch { /* Existing installs already have the column. */ } }
  return db;
}

export async function initializeDatabase() {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR IGNORE INTO sessions (id, title, created_at) VALUES (?, ?, ?)',
    'default-session',
    'New conversation',
    Date.now(),
  );
}

export async function loadSessions(): Promise<ChatSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; title: string; created_at: number; web_search_enabled: number; web_search_depth: string; show_thinking: number; thinking_enabled: number }>('SELECT id, title, created_at, web_search_enabled, web_search_depth, show_thinking, thinking_enabled FROM sessions ORDER BY created_at DESC');
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    webSearchEnabled: row.web_search_enabled === 1,
    webSearchDepth: row.web_search_depth === 'advanced' ? 'advanced' : 'basic',
    showThinking: row.show_thinking === 1,
    thinkingEnabled: row.thinking_enabled === 1,
  }));
}

export async function createSession(session: ChatSession) {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO sessions (id, title, created_at, web_search_enabled, web_search_depth, show_thinking, thinking_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)', session.id, session.title, session.createdAt, session.webSearchEnabled ? 1 : 0, session.webSearchDepth, session.showThinking ? 1 : 0, session.thinkingEnabled ? 1 : 0);
  await Storage.setItem(ACTIVE_SESSION_KEY, session.id);
}

export async function loadActiveSessionId() {
  return (await Storage.getItem(ACTIVE_SESSION_KEY)) || 'default-session';
}

const CUSTOM_MODELS_KEY = 'custom-models-v1';

export async function loadCustomModels(): Promise<ModelDefinition[]> {
  try {
    const value = await Storage.getItem(CUSTOM_MODELS_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((model) => model && typeof model.id === 'string' && typeof model.url === 'string' && typeof model.filename === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveCustomModels(models: ModelDefinition[]) {
  await Storage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(models));
}

export async function saveActiveSessionId(sessionId: string) {
  await Storage.setItem(ACTIVE_SESSION_KEY, sessionId);
}

export async function loadMessages(sessionId: string): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; session_id: string; sender: 'user' | 'assistant'; content: string; created_at: number }>(
    'SELECT id, session_id, sender, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    sessionId,
  );
  return rows.map((row) => ({ id: row.id, sessionId: row.session_id, sender: row.sender, content: row.content, createdAt: row.created_at }));
}

export async function saveMessage(message: Message) {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO messages (id, session_id, sender, content, created_at) VALUES (?, ?, ?, ?, ?)',
    message.id, message.sessionId, message.sender, message.content, message.createdAt,
  );
}

export async function loadArtifacts(sessionId?: string): Promise<Artifact[]> {
  const db = await getDb();
  const rows = sessionId
    ? await db.getAllAsync<{ id: string; session_id: string | null; title: string; html: string; source_message_id: string | null; created_at: number }>('SELECT id, session_id, title, html, source_message_id, created_at FROM artifacts WHERE session_id = ? OR session_id IS NULL ORDER BY created_at DESC', sessionId)
    : await db.getAllAsync<{ id: string; session_id: string | null; title: string; html: string; source_message_id: string | null; created_at: number }>('SELECT id, session_id, title, html, source_message_id, created_at FROM artifacts ORDER BY created_at DESC');
  return rows.map((row) => ({ id: row.id, sessionId: row.session_id ?? sessionId ?? 'default-session', title: row.title, html: row.html, sourceMessageId: row.source_message_id ?? undefined, createdAt: row.created_at }));
}

export async function saveArtifact(artifact: Artifact) {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO artifacts (id, session_id, title, html, source_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    artifact.id, artifact.sessionId, artifact.title, artifact.html, artifact.sourceMessageId ?? null, artifact.createdAt,
  );
}

export async function executeLocalDBWrite(payload: { appContext: string; jsonPayload: unknown }) {
  try {
    const db = await getDb();
    const result = await db.runAsync(
      'INSERT INTO saved_data (app_context, json_payload, created_at) VALUES (?, ?, ?)',
      payload.appContext,
      JSON.stringify(payload.jsonPayload),
      Date.now(),
    );
    return { success: true, insertId: result.lastInsertRowId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Storage write failed' };
  }
}

export async function loadGenerationSettings(): Promise<GenerationSettings> {
  try {
    const value = await Storage.getItem(SETTINGS_KEY);
    if (!value) return { ...DEFAULT_GENERATION_SETTINGS, systemPrompt: '' };
    const saved = JSON.parse(value) as Partial<GenerationSettings>;
    const numberOrDefault = (candidate: unknown, fallback: number, min: number, max: number) => {
      const number = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
      return Math.min(max, Math.max(min, number));
    };
    return {
      systemPrompt: typeof saved.systemPrompt === 'string' ? saved.systemPrompt : '',
      temperature: numberOrDefault(saved.temperature, DEFAULT_GENERATION_SETTINGS.temperature, 0, 1.5),
      topP: numberOrDefault(saved.topP, DEFAULT_GENERATION_SETTINGS.topP, 0.1, 1),
      maxTokens: Math.round(numberOrDefault(saved.maxTokens, DEFAULT_GENERATION_SETTINGS.maxTokens, 256, 2048) / 128) * 128,
      contextSize: Math.round(numberOrDefault(saved.contextSize, DEFAULT_GENERATION_SETTINGS.contextSize, 1024, 4096) / 512) * 512,
      threads: Math.round(numberOrDefault(saved.threads, DEFAULT_GENERATION_SETTINGS.threads, 1, 6)),
      gpuLayers: Math.round(numberOrDefault(saved.gpuLayers, DEFAULT_GENERATION_SETTINGS.gpuLayers, 0, 99)),
      showThinking: saved.showThinking === true,
      responseMode: saved.responseMode === 'chat' || saved.responseMode === 'canvas' ? saved.responseMode : 'auto',
      webSearchEnabled: saved.webSearchEnabled === true,
      webSearchDepth: saved.webSearchDepth === 'advanced' ? 'advanced' : 'basic',
    };
  } catch {
    return { ...DEFAULT_GENERATION_SETTINGS, systemPrompt: '' };
  }
}

export async function saveGenerationSettings(settings: GenerationSettings) {
  await Storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadTavilyApiKey() {
  try {
    return (await SecureStore.getItemAsync(TAVILY_API_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function saveTavilyApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized) {
    await SecureStore.setItemAsync(TAVILY_API_KEY, normalized, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(TAVILY_API_KEY);
  }
}
