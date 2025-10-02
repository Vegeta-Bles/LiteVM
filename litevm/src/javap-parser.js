const HEADER_CLASS_REGEX = /class\s+([^\s{]+)(?:\s+extends\s+([^\s{]+))?/;
const METHOD_SIGNATURE_REGEX = /^(?:\s*)(?:[\w\[\]$.<>]+\s+)*([\w$<>]+)\(([^)]*)\);/;

export function parseJavapDisassembly(text) {
  const lines = text.split(/\r?\n/);
  const ir = {
    className: null,
    superName: 'java/lang/Object',
    methods: [],
    fields: []
  };

  let currentMethod = null;
  let inCode = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!ir.className) {
      const classMatch = HEADER_CLASS_REGEX.exec(trimmed);
      if (classMatch) {
        ir.className = classMatch[1].replace(/\./g, '/');
        if (classMatch[2]) {
          ir.superName = classMatch[2].replace(/\./g, '/');
        }
        continue;
      }
    }

    if (!currentMethod) {
      const methodMatch = METHOD_SIGNATURE_REGEX.exec(line);
      if (methodMatch) {
        let methodName = methodMatch[1];
        const simpleClassName = ir.className?.split('/').pop();
        if (methodName === simpleClassName) {
          methodName = '<init>';
        }
        if (methodName === 'static') {
          methodName = '<clinit>';
        }

        currentMethod = {
          name: methodName,
          descriptor: null,
          flags: [],
          maxStack: 0,
          maxLocals: 0,
          argsSize: 0,
          instructions: []
        };
        continue;
      }
      continue;
    }

    if (!inCode) {
      if (trimmed.startsWith('descriptor:')) {
        currentMethod.descriptor = trimmed.split(':')[1].trim();
        continue;
      }
      if (trimmed.startsWith('flags:')) {
        const flagsPart = trimmed.split(':')[1].trim();
        currentMethod.flags = flagsPart
          .split(/[,\s]+/)
          .map((token) => token.replace(/[()]/g, ''))
          .filter((token) => token.startsWith('ACC_'));
        continue;
      }
      if (trimmed.startsWith('Code:')) {
        inCode = true;
        continue;
      }
    } else {
      if (trimmed.startsWith('stack=')) {
        const metrics = trimmed.split(',').map((part) => part.trim());
        for (const metric of metrics) {
          const [key, value] = metric.split('=').map((part) => part.trim());
          switch (key) {
            case 'stack':
              currentMethod.maxStack = Number(value);
              break;
            case 'locals':
              currentMethod.maxLocals = Number(value);
              break;
            case 'args_size':
              currentMethod.argsSize = Number(value);
              break;
            default:
              break;
          }
        }
        continue;
      }

      const instructionMatch = /^\s*(\d+):\s+([a-z_0-9]+)(.*)$/i.exec(line);
      if (instructionMatch) {
        const offset = Number(instructionMatch[1]);
        const mnemonic = instructionMatch[2].toUpperCase();
        const remainder = instructionMatch[3] ?? '';
        const [rawArgs, comment] = splitComment(remainder);
        const args = parseArgs(rawArgs);
        currentMethod.instructions.push({
          offset,
          op: mnemonic,
          args,
          comment,
          ownerClass: ir.className,
        });
        continue;
      }

      if (
        trimmed === '' ||
        trimmed.startsWith('LineNumberTable') ||
        trimmed.startsWith('LocalVariableTable') ||
        trimmed.startsWith('Exceptions:') ||
        trimmed.startsWith('RuntimeVisibleAnnotations:') ||
        trimmed.startsWith('RuntimeInvisibleAnnotations:') ||
        trimmed.startsWith('StackMapTable')
      ) {
        if (currentMethod.instructions.length) {
          ir.methods.push(currentMethod);
        }
        currentMethod = null;
        inCode = false;
        continue;
      }
    }
  }

  if (currentMethod) {
    ir.methods.push(currentMethod);
  }

  return ir;
}

function splitComment(segment) {
  const idx = segment.indexOf('//');
  if (idx === -1) {
    return [segment.trim(), null];
  }
  const args = segment.slice(0, idx).trim();
  const comment = segment.slice(idx + 2).trim();
  return [args, comment || null];
}

function parseArgs(raw) {
  if (!raw) return [];

  const tokens = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((chunk) => chunk.split(/\s+/))
    .filter(Boolean);

  return tokens.map((token) => {
    if (/^#\d+$/.test(token)) {
      return { kind: 'const', value: Number(token.slice(1)) };
    }
    if (/^[+-]?\d+$/.test(token)) {
      return { kind: 'int', value: Number(token) };
    }
    if (/^0x[0-9a-f]+$/i.test(token)) {
      return { kind: 'int', value: Number.parseInt(token, 16) };
    }
    return { kind: 'raw', value: token };
  });
}
