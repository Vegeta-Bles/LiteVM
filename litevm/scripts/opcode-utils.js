import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DISPATCH_REGEX = /_dispatch\s*\([^]*?switch\s*\(op\)\s*{([^]*?)\n\s*}\n\s*}/m;
const CASE_REGEX = /case\s+'([^']+)'/g;

export async function getSupportedOpcodes(runtimePath = resolve(process.cwd(), 'runtime/runtime.js')) {
  const source = await readFile(runtimePath, 'utf8');
  const match = DISPATCH_REGEX.exec(source);
  if (!match) {
    throw new Error('Unable to locate _dispatch switch block in runtime/runtime.js');
  }

  const body = match[1];
  const opcodes = new Set();
  let caseMatch;
  while ((caseMatch = CASE_REGEX.exec(body)) !== null) {
    opcodes.add(caseMatch[1]);
  }

  return Array.from(opcodes).sort();
}

export function normalizeOpcodeName(name) {
  return name.replace(/\s+/g, '').toUpperCase();
}

export default { getSupportedOpcodes, normalizeOpcodeName };

