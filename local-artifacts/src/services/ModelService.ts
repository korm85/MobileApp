import * as FileSystem from 'expo-file-system/legacy';
import {
  completeHandler,
  createDownloadTask,
  directories,
  getExistingDownloadTasks,
} from '@kesha-antonov/react-native-background-downloader';
import { MODELS } from '../constants';

export type ModelDownloadUpdate = {
  modelId: string;
  status: 'downloading' | 'ready' | 'error';
  progress: number;
  error?: string;
};

const listeners = new Set<(update: ModelDownloadUpdate) => void>();
const activeTasks = new Map<string, ReturnType<typeof createDownloadTask>>();

export function getModelPath(filename: string) {
  return `${FileSystem.documentDirectory}models/${filename}`;
}

export async function ensureModelDirectory() {
  const directory = `${FileSystem.documentDirectory}models/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
}

export async function modelExists(filename: string) {
  const info = await FileSystem.getInfoAsync(getModelPath(filename));
  return info.exists;
}

export function subscribeModelDownloads(listener: (update: ModelDownloadUpdate) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(update: ModelDownloadUpdate) {
  listeners.forEach((listener) => listener(update));
}

function attachTask(task: ReturnType<typeof createDownloadTask>, modelId: string) {
  activeTasks.set(modelId, task);
  task
    .progress(({ bytesDownloaded, bytesTotal }) => emit({
      modelId,
      status: 'downloading',
      progress: bytesTotal > 0 ? bytesDownloaded / bytesTotal : 0,
    }))
    .done(({ location }) => {
      completeHandler(task.id);
      activeTasks.delete(modelId);
      emit({ modelId, status: 'ready', progress: 1 });
      void location;
    })
    .error(({ error }) => {
      activeTasks.delete(modelId);
      emit({ modelId, status: 'error', progress: 0, error });
    });
}

export async function reattachExistingModelDownloads() {
  const tasks = await getExistingDownloadTasks();
  for (const task of tasks) {
    const modelId = typeof task.metadata?.modelId === 'string' ? task.metadata.modelId : null;
    if (!modelId) continue;
    attachTask(task, modelId);
    if (task.state === 'DONE') emit({ modelId, status: 'ready', progress: 1 });
    else if (task.state === 'DOWNLOADING' || task.state === 'PENDING') emit({ modelId, status: 'downloading', progress: task.bytesTotal > 0 ? task.bytesDownloaded / task.bytesTotal : 0 });
  }
}

export async function downloadModel(modelId: string) {
  const model = MODELS.find((item) => item.id === modelId);
  if (!model) throw new Error('Unknown model');
  if (activeTasks.has(modelId)) return;

  await ensureModelDirectory();
  const destination = getModelPath(model.filename);
  const task = createDownloadTask({
    id: `model-${modelId}`,
    url: model.url,
    destination,
    metadata: { modelId, filename: model.filename },
    isAllowedOverMetered: false,
  });

  attachTask(task, modelId);
  emit({ modelId, status: 'downloading', progress: 0 });
  task.start();
}

export async function pauseModelDownload(modelId: string) {
  await activeTasks.get(modelId)?.pause();
}

export async function resumeModelDownload(modelId: string) {
  await activeTasks.get(modelId)?.resume();
}

export async function cancelModelDownload(modelId: string) {
  await activeTasks.get(modelId)?.stop();
  activeTasks.delete(modelId);
}

export async function deleteModel(filename: string) {
  await FileSystem.deleteAsync(getModelPath(filename), { idempotent: true });
}

// Keep the native downloader's document directory discoverable for diagnostics.
export function getBackgroundDocumentsDirectory() {
  return directories.documents;
}
