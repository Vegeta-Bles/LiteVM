import { spawnSync } from 'node:child_process';
import { getSupportedOpcodes, normalizeOpcodeName } from './opcode-utils.js';
import { normalizeOpcode } from './opcodes-data.js';

function parseArgs(argv) {
  const args = {
    jar: null,
    limit: Infinity,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--jar') {
      args.jar = argv[++i];
    } else if (token === '--limit') {
      args.limit = Number(argv[++i]);
    } else {
      args.jar = token;
    }
  }

  if (!args.jar) {
    throw new Error('Usage: node scripts/opcode-usage.js --jar path/to/client.jar [--limit 200]');
  }

  return args;
}

function listClasses(jarPath) {
  const result = spawnSync('jar', ['tf', jarPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`jar tf failed: ${result.stderr}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.endsWith('.class'))
    .map((line) => line.replace(/\.class$/, '').replace(/\//g, '.'));
}

function collectOpcodesFromClass(jarPath, className) {
  const result = spawnSync('javap', ['-p', '-classpath', jarPath, '-c', className], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `javap failed for ${className}`);
  }

  const counts = new Map();
  const instructionRegex = /^\s*\d+:\s+([a-z_0-9]+)/i;
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = instructionRegex.exec(line);
    if (match) {
      const opcode = normalizeOpcode(match[1].toUpperCase());
      counts.set(opcode, (counts.get(opcode) || 0) + 1);
    }
  }
  return counts;
}

function mergeCounts(target, delta) {
  for (const [key, value] of delta.entries()) {
    target.set(key, (target.get(key) || 0) + value);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const classes = listClasses(args.jar);
  const supported = new Set((await getSupportedOpcodes()).map(normalizeOpcodeName));

  const globalCounts = new Map();
  let processed = 0;

  for (const className of classes) {
    if (processed >= args.limit) break;
    try {
      const counts = collectOpcodesFromClass(args.jar, className);
      mergeCounts(globalCounts, counts);
      processed += 1;
    } catch (error) {
      console.warn(`Skipping ${className}: ${error.message}`);
    }
  }

  const sorted = Array.from(globalCounts.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`# Opcode usage across ${processed} classes`);
  for (const [opcode, count] of sorted) {
    const status = supported.has(opcode) ? 'supported' : 'missing';
    console.log(`${opcode.padEnd(16)} ${String(count).padStart(8)} ${status}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
