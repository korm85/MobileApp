import * as FileSystem from 'expo-file-system/legacy';
import {
  completeHandler,
  createDownloadTask,
  directories,
  getExistingDownloadTasks,
} from '@kesha-antonov/react-native-background-downloader';
import { MODELS } from '../constants';
import { ModelDefinition } from '../types';

export type ModelDownloadUpdate = {
  modelId: string;
  status: 'downloading' | 'ready' | 'error';
  progress: number;
  error?: string;
};

type AssetKey = 'model' | 'mmproj' | 'mtp';
type AssetSpec = { key: AssetKey; filename: string; url: string; weight: number };

const listeners = new Set<(update: ModelDownloadUpdate) => void>();
const activeTasks = new Map<string, ReturnType<typeof createDownloadTask>>();
const MIN_VALID_BYTES = 1024 * 1024;

export function getModelPath(filename: string) {
  return `${FileSystem.documentDirectory}models/${filename}`;
}

export async function ensureModelDirectory() {
  const directory = `${FileSystem.documentDirectory}models/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
}

async function assetExists(filename: string) {
  const info = await FileSystem.getInfoAsync(getModelPath(filename));
  return info.exists && typeof info.size === 'number' && info.size >= MIN_VALID_BYTES;
}

export async function modelExists(filename: string) {
  return assetExists(filename);
}

function specsFor(model: ModelDefinition): AssetSpec[] {
  const specs: AssetSpec[] = [{ key: 'model', filename: model.filename, url: model.url, weight: 0.70 }];
  if (model.mmprojFilename && model.mmprojUrl) specs.push({ key: 'mmproj', filename: model.mmprojFilename, url: model.mmprojUrl, weight: 0.25 });
  if (model.mtpFilename && model.mtpUrl) specs.push({ key: 'mtp', filename: model.mtpFilename, url: model.mtpUrl, weight: 0.05 });
  return specs;
}

export async function modelDefinitionReady(model: ModelDefinition) {
  const specs = specsFor(model);
  for (const spec of specs) if (!(await assetExists(spec.filename))) return false;
  return true;
}

function taskKey(modelId: string, asset: AssetKey) {
  return modelId + ':' + asset;
}

function emit(update: ModelDownloadUpdate) {
  listeners.forEach((listener) => listener(update));
}

async function progressFor(model: ModelDefinition) {
  const specs = specsFor(model);
  let progress = 0;
  for (const spec of specs) {
    if (await assetExists(spec.filename)) progress += spec.weight;
    else {
      const task = activeTasks.get(taskKey(model.id, spec.key));
      if (task && task.bytesTotal > 0) progress += spec.weight * (task.bytesDownloaded / task.bytesTotal);
    }
  }
  return Math.min(1, progress);
}

function attachTask(task: ReturnType<typeof createDownloadTask>, model: ModelDefinition, spec: AssetSpec) {
  const key = taskKey(model.id, spec.key);
  activeTasks.set(key, task);
  task
    .progress(({ bytesDownloaded, bytesTotal }) => {
      void progressFor(model).then((progress) => emit({ modelId: model.id, status: 'downloading', progress }));
    })
    .done(({ location }) => {
      void (async () => {
        try {
          await completeHandler(task.id);
          activeTasks.delete(key);
          if (!(await assetExists(spec.filename))) throw new Error('Downloaded model asset is incomplete.');
          if (await modelDefinitionReady(model)) emit({ modelId: model.id, status: 'ready', progress: 1 });
          else await startNextAsset(model);
        } catch (error) {
          activeTasks.delete(key);
          emit({ modelId: model.id, status: 'error', progress: 0, error: error instanceof Error ? error.message : 'Model download verification failed.' });
        }
        void location;
      })();
    })
    .error(({ error }) => {
      activeTasks.delete(key);
      void task.stop().catch(() => undefined);
      emit({ modelId: model.id, status: 'error', progress: 0, error });
    });
}

async function startNextAsset(model: ModelDefinition) {
  for (const spec of specsFor(model)) {
    if (await assetExists(spec.filename)) continue;
    const key = taskKey(model.id, spec.key);
    if (activeTasks.has(key)) return;
    await ensureModelDirectory();
    const destination = getModelPath(spec.filename);
    const existing = await FileSystem.getInfoAsync(destination);
    if (existing.exists) await FileSystem.deleteAsync(destination, { idempotent: true });
    const task = createDownloadTask({
      id: `model-${model.id}-${spec.key}-${Date.now()}`,
      url: spec.url,
      destination,
      metadata: { modelId: model.id, asset: spec.key, filename: spec.filename },
      isAllowedOverMetered: false,
    });
    attachTask(task, model, spec);
    emit({ modelId: model.id, status: 'downloading', progress: await progressFor(model) });
    task.start();
    return;
  }
  emit({ modelId: model.id, status: 'ready', progress: 1 });
}

export function subscribeModelDownloads(listener: (update: ModelDownloadUpdate) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function reattachExistingModelDownloads(models: ModelDefinition[] = MODELS) {
  const tasks = await getExistingDownloadTasks();
  for (const task of tasks) {
    const modelId = typeof task.metadata?.modelId === 'string' ? task.metadata.modelId : null;
    if (!modelId) continue;
    const model = models.find((item) => item.id === modelId);
    if (!model) continue;
    const asset = task.metadata?.asset === 'mmproj' || task.metadata?.asset === 'mtp' ? task.metadata.asset : 'model';
    const key = taskKey(modelId, asset);
    if (activeTasks.has(key)) continue;
    if (task.state === 'DONE') {
      if (await assetExists(task.metadata?.filename || model.filename)) {
        activeTasks.delete(key);
        if (await modelDefinitionReady(model)) emit({ modelId, status: 'ready', progress: 1 });
        else await startNextAsset(model);
      } else await task.stop().catch(() => undefined);
      continue;
    }
    if (task.state === 'DOWNLOADING' || task.state === 'PENDING' || task.state === 'PAUSED') {
      const spec = specsFor(model).find((item) => item.key === asset);
      if (spec) {
        attachTask(task, model, spec);
        emit({ modelId, status: 'downloading', progress: await progressFor(model) });
      }
    }
  }
}

export async function downloadModel(modelId: string, models: ModelDefinition[] = MODELS) {
  const model = models.find((item) => item.id === modelId);
  if (!model) throw new Error('Unknown model');
  return downloadModelDefinition(model, models);
}

export async function downloadModelDefinition(model: ModelDefinition, models: ModelDefinition[] = MODELS) {
  await reattachExistingModelDownloads(models);
  if (await modelDefinitionReady(model)) {
    emit({ modelId: model.id, status: 'ready', progress: 1 });
    return;
  }
  await startNextAsset(model);
}

export async function pauseModelDownload(modelId: string) {
  for (const key of Array.from(activeTasks.keys())) if (key.startsWith(modelId + ':')) await activeTasks.get(key)?.pause();
}

export async function resumeModelDownload(modelId: string) {
  for (const key of Array.from(activeTasks.keys())) if (key.startsWith(modelId + ':')) await activeTasks.get(key)?.resume();
}

export async function cancelModelDownload(modelId: string) {
  for (const key of Array.from(activeTasks.keys())) {
    if (!key.startsWith(modelId + ':')) continue;
    await activeTasks.get(key)?.stop();
    activeTasks.delete(key);
  }
}

export async function deleteModel(filename: string) {
  await FileSystem.deleteAsync(getModelPath(filename), { idempotent: true });
}

export function getBackgroundDocumentsDirectory() {
  return directories.documents;
}
