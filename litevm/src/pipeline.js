import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { discoverClasses } from './stage-discover.js';
import { disassembleClass } from './stage-disassemble.js';
import { emitBundle } from './stage-emit.js';

export async function compileJar(options) {
  const { jarPath, outFile, format, runtimeMode } = options;

  const classes = await discoverClasses(jarPath);
  const ir = [];

  for (const className of classes) {
    const classIr = await disassembleClass({ jarPath, className });
    ir.push(classIr);
  }

  const { code, runtimeBytes } = await emitBundle({
    classes: ir,
    format,
    runtimeMode
  });

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, code, 'utf8');

  return {
    outputFile: outFile,
    classes: ir.length,
    bytes: Buffer.byteLength(code, 'utf8'),
    runtimeBytes
  };
}
