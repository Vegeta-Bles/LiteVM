import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { compileJar } from '../src/pipeline.js';

const SAMPLE_JAVA = new URL('../samples/Sample.java', import.meta.url);
const OBJECT_SAMPLE_JAVA = new URL('../samples/ObjectSample.java', import.meta.url);

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      ...opts,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

test('compiles sample jar and executes add method', async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'litevm-'));
  const classesDir = join(tmpDir, 'classes');
  const jarPath = join(tmpDir, 'sample.jar');
  const outFile = join(tmpDir, 'bundle.js');

  t.after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  await mkdir(classesDir, { recursive: true });
  await run('javac', [
    '-d',
    classesDir,
    fileURLToPath(SAMPLE_JAVA),
    fileURLToPath(OBJECT_SAMPLE_JAVA),
  ]);
  await run('jar', ['cf', jarPath, '-C', classesDir, '.']);

  const result = await compileJar({
    jarPath,
    outFile,
    format: 'esm',
    runtimeMode: 'embedded'
  });

  assert.ok(result.classes > 0, 'expects classes to be emitted');

  const bundleContent = await readFile(outFile, 'utf8');
  assert.ok(bundleContent.length > 1000, 'bundle should be non-trivial');

  const moduleUrl = pathToFileURL(outFile);
  const runtimeModule = await import(`${moduleUrl.href}?${Date.now()}`);
  const runtime = runtimeModule.default;
  const value = runtime.invokeStatic('Sample', 'add', '(II)I', [7, 35]);
  assert.equal(value, 42);

  const object = runtime.invokeStatic(
    'ObjectSample',
    'create',
    '(I)LObjectSample;',
    [99],
  );

  assert.ok(object, 'expected object instance from factory');
  assert.equal(object.__litevmClass, 'ObjectSample');
  assert.equal(object.fields.counter, 99);

  const counter = runtime.invokeVirtual(
    'ObjectSample',
    'getCounter',
    '()I',
    object,
  );
  assert.equal(counter, 99);
});
