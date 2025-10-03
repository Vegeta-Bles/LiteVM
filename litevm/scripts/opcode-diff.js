import { getSupportedOpcodes } from './opcode-utils.js';
import { getNormalizedOpcodeSet, normalizeOpcode } from './opcodes-data.js';

async function main() {
  const supportedRaw = await getSupportedOpcodes();
  const normalize = (name) => normalizeOpcode(name);
  const supported = new Set(supportedRaw.map(normalize));

  const all = getNormalizedOpcodeSet();
  const missing = [];
  for (const opcode of all) {
    if (!supported.has(opcode)) {
      missing.push(opcode);
    }
  }

  missing.sort();
  console.log(`# Missing opcodes (${missing.length})`);
  for (const opcode of missing) {
    console.log(opcode);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

