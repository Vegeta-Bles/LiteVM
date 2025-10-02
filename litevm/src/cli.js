import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { compileJar } from './pipeline.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function parseArgs(argv) {
  const args = {
    jar: null,
    out: 'dist/bundle.js',
    format: 'esm',
    runtime: 'embedded'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--jar':
        args.jar = argv[++i];
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--format':
        args.format = argv[++i];
        break;
      case '--runtime':
        args.runtime = argv[++i];
        break;
      case '--version':
      case '-v':
        console.log(`litevm v${pkg.version}`);
        process.exit(0);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (!token.startsWith('-') && !args.jar) {
          args.jar = token;
        } else {
          console.warn(`Ignoring unknown argument: ${token}`);
        }
    }
  }

  return args;
}

function printHelp() {
  console.log(`litevm v${pkg.version}\n\n` +
    'Usage: litevm --jar <input.jar> [--out dist/game.js] [--format esm|iife]\n\n' +
    'Options:\n' +
    '  --jar       Path to the input JAR archive\n' +
    '  --out       Output JavaScript bundle path (default dist/bundle.js)\n' +
    '  --format    Output format: esm (default) or iife\n' +
    '  --runtime   Runtime packaging: embedded (default) or external\n' +
    '  --help      Show this message\n' +
    '  --version   Print version');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jar) {
    printHelp();
    process.exit(1);
  }

  const outPath = resolve(process.cwd(), args.out);
  const inputJar = resolve(process.cwd(), args.jar);

  try {
    const result = await compileJar({
      jarPath: inputJar,
      outFile: outPath,
      format: args.format,
      runtimeMode: args.runtime
    });
    console.log(`✓ Wrote bundle ${result.outputFile} (${result.bytes} bytes)`);
  } catch (error) {
    console.error('Compilation failed:', error.message);
    if (process.env.LITEVM_DEBUG) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
