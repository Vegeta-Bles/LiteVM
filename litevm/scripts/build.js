import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRuntimeTemplate } from '../src/template-runtime.js';

async function main() {
  const runtime = await createRuntimeTemplate();
  const outDir = resolve(process.cwd(), 'dist');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'runtime.js'), runtime, 'utf8');
  console.log('✓ Runtime emitted to dist/runtime.js');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
