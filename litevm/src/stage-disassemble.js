import { spawn } from 'node:child_process';
import { parseJavapDisassembly } from './javap-parser.js';

export async function disassembleClass({ jarPath, className }) {
  const disassembly = await runJavap({ jarPath, className });
  return parseJavapDisassembly(disassembly);
}

function runJavap({ jarPath, className }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '-classpath', jarPath, '-c', '-verbose', className];
    const proc = spawn('javap', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`javap exited with ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}
