import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const runtimePath = resolve(dirname(fileURLToPath(import.meta.url)), '../runtime/runtime.js');

let cachedRuntime = null;

export function createRuntimeTemplate() {
  if (cachedRuntime) return cachedRuntime;
  return readFile(runtimePath, 'utf8').then((code) => {
    cachedRuntime = code;
    return cachedRuntime;
  });
}
