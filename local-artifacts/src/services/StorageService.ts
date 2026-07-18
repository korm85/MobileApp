import * as SQLite from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { Artifact, GenerationSettings, Message } from '../types';
import { DEFAULT_GENERATION_SETTINGS } from '../constants';

const SETTINGS_KEY = 'generation-settings-v1';

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
      created_at INTEGER NOT NULL
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

export async function loadArtifacts(): Promise<Artifact[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; title: string; html: string; source_message_id: string | null; created_at: number }>(
    'SELECT id, title, html, source_message_id, created_at FROM artifacts ORDER BY created_at DESC',
  );
  return rows.map((row) => ({ id: row.id, title: row.title, html: row.html, sourceMessageId: row.source_message_id ?? undefined, createdAt: row.created_at }));
}

export async function saveArtifact(artifact: Artifact) {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO artifacts (id, title, html, source_message_id, created_at) VALUES (?, ?, ?, ?, ?)',
    artifact.id, artifact.title, artifact.html, artifact.sourceMessageId ?? null, artifact.createdAt,
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
    };
  } catch {
    return { ...DEFAULT_GENERATION_SETTINGS, systemPrompt: '' };
  }
}

export async function saveGenerationSettings(settings: GenerationSettings) {
  await Storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
