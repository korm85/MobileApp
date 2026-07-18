import * as FileSystem from 'expo-file-system/legacy';
import { MODELS } from '../constants';

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

export async function downloadModel(
  modelId: string,
  onProgress: (progress: number) => void,
) {
  const model = MODELS.find((item) => item.id === modelId);
  if (!model) throw new Error('Unknown model');
  await ensureModelDirectory();
  const target = getModelPath(model.filename);
  const download = FileSystem.createDownloadResumable(model.url, target, {}, (event) => {
    const progress = event.totalBytesExpectedToWrite > 0
      ? event.totalBytesWritten / event.totalBytesExpectedToWrite
      : 0;
    onProgress(progress);
  });
  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error('Model download did not complete');
  return result.uri;
}

export async function deleteModel(filename: string) {
  await FileSystem.deleteAsync(getModelPath(filename), { idempotent: true });
}
