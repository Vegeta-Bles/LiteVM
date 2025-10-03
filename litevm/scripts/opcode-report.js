import { getSupportedOpcodes } from './opcode-utils.js';

async function main() {
  const opcodes = await getSupportedOpcodes();
  for (const opcode of opcodes) {
    console.log(opcode);
  }
  console.log(`\nTotal opcodes: ${opcodes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

