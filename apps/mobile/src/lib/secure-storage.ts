import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 1800;
const metadataKey = (key: string) => `${key}::chunks`;
const chunkKey = (key: string, index: number) => `${key}::${index}`;

async function chunkCount(key: string) {
  const raw = await SecureStore.getItemAsync(metadataKey(key));
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const secureStorage = {
  async getItem(key: string) {
    const count = await chunkCount(key);
    if (!count) return null;
    const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))));
    return chunks.some((chunk) => chunk === null) ? null : chunks.join("");
  },
  async setItem(key: string, value: string) {
    const previousCount = await chunkCount(key);
    const chunks = value ? Array.from({ length: Math.ceil(value.length / CHUNK_SIZE) }, (_, index) => value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)) : [""];
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)));
    await SecureStore.setItemAsync(metadataKey(key), String(chunks.length));
    await Promise.all(Array.from({ length: Math.max(0, previousCount - chunks.length) }, (_, offset) => SecureStore.deleteItemAsync(chunkKey(key, chunks.length + offset))));
  },
  async removeItem(key: string) {
    const count = await chunkCount(key);
    await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))));
    await SecureStore.deleteItemAsync(metadataKey(key));
  },
};
