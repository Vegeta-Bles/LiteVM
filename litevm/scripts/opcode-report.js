import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Extracts switch-case labels from the runtime dispatcher to understand opcode coverage.

async function main() {
  const runtimePath = resolve(process.cwd(), 'runtime/runtime.js');
  const source = await readFile(runtimePath, 'utf8');

  const dispatchMatch = /_dispatch\s*\([^]*?switch\s*\(op\)\s*{([^]*?)\n\s*}\n\s*}/m.exec(source);
  if (!dispatchMatch) {
    console.error('Could not locate _dispatch switch block in runtime/runtime.js');
    process.exit(1);
  }

  const body = dispatchMatch[1];
  const caseRegex = /case\s+'([^']+)'/g;
  const opcodes = new Set();
  let match;
  while ((match = caseRegex.exec(body)) !== null) {
    opcodes.add(match[1]);
  }

  const sorted = Array.from(opcodes).sort();
  for (const opcode of sorted) {
    console.log(opcode);
  }
  console.log(`\nTotal opcodes: ${sorted.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

