import { spawn } from 'node:child_process';

export function discoverClasses(jarPath) {
  return new Promise((resolve, reject) => {
    const jarProc = spawn('jar', ['tf', jarPath]);
    const classes = [];
    let stderr = '';

    jarProc.stdout.setEncoding('utf8');
    jarProc.stdout.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.endsWith('.class')) continue;
        const className = line.replace(/\.class$/, '').replace(/\//g, '.');
        classes.push(className);
      }
    });

    jarProc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    jarProc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`jar tf exited with ${code}: ${stderr}`));
      } else {
        resolve(classes);
      }
    });
  });
}
