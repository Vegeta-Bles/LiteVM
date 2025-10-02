import { normalizeClasses } from './ir-normalize.js';
import { createRuntimeTemplate } from './template-runtime.js';

export async function emitBundle({ classes, format = 'esm', runtimeMode = 'embedded' }) {
  const normalized = normalizeClasses(classes);
  const runtime = await createRuntimeTemplate();
  const manifest = JSON.stringify(normalized, null, 2);

  let code = '';
  if (format === 'esm') {
    if (runtimeMode === 'embedded') {
      code += `${runtime}\n\n`;
      code += `const manifest = ${manifest};\n`;
      code += `const runtimeInstance = LiteVMRuntime.bootstrap(manifest);\n`;
      code += `export default runtimeInstance;\n`;
    } else {
      code += `import { LiteVMRuntime } from './runtime.js';\n`;
      code += `const manifest = ${manifest};\n`;
      code += `export default LiteVMRuntime.bootstrap(manifest);\n`;
    }
  } else if (format === 'iife') {
    code += `(function(){\n${runtime}\nconst manifest = ${manifest};\nreturn LiteVMRuntime.bootstrap(manifest);\n})();\n`;
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }

  return { code, runtimeBytes: runtime.length };
}
