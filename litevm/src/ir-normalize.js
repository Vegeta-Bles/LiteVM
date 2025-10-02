export function normalizeClasses(classes) {
  return classes.map(normalizeClass);
}

function normalizeClass(irClass) {
  return {
    className: irClass.className,
    superName: irClass.superName,
    methods: irClass.methods.map((method) => normalizeMethod(method, irClass.className))
  };
}

function normalizeMethod(method, className) {
  const offsetMap = new Map();
  method.instructions.forEach((instr, index) => {
    offsetMap.set(instr.offset, index);
  });

  const instructions = method.instructions.map((instr) =>
    normalizeInstruction(instr, offsetMap, className)
  );

  // Resolve branch targets to indices for faster runtime jumps
  for (const instruction of instructions) {
    if (!instruction.args) continue;
    instruction.args = instruction.args.map((arg) => {
      if (arg.kind === 'target') {
        const targetIndex = offsetMap.get(arg.value);
        if (typeof targetIndex !== 'number') {
          throw new Error(`Unresolved branch target offset ${arg.value}`);
        }
        return { kind: 'target', value: targetIndex };
      }
      return arg;
    });
  }

  return {
    name: method.name,
    descriptor: method.descriptor,
    flags: method.flags,
    maxStack: method.maxStack,
    maxLocals: method.maxLocals,
    argsSize: method.argsSize,
    instructions,
    className
  };
}

function normalizeInstruction(instr, offsetMap, className) {
  const { op, args, comment, offset, ownerClass } = instr;

  if (op.includes('_')) {
    const [base, suffix] = op.split('_');
    if (/^\d+$/.test(suffix)) {
      return {
        offset,
        op: base,
        args: [{ kind: 'int', value: Number(suffix) }],
        meta: buildMeta(comment)
      };
    }
  }

  const normalized = { offset, op, args: [], meta: buildMeta(comment) };

  switch (op) {
    case 'BIPUSH':
    case 'SIPUSH':
    case 'ILOAD':
    case 'ISTORE':
    case 'ALOAD':
    case 'ASTORE':
    case 'IINC':
      normalized.args = args.map((arg) =>
        arg.kind === 'int' ? { kind: 'int', value: arg.value } : arg
      );
      break;
    case 'LDC':
      normalized.args = [parseLdcValue(comment)];
      break;
    case 'GOTO':
    case 'IF_ICMPEQ':
    case 'IF_ICMPNE':
    case 'IF_ICMPLT':
    case 'IF_ICMPLE':
    case 'IF_ICMPGT':
    case 'IF_ICMPGE':
    case 'IFEQ':
    case 'IFNE':
    case 'IFLT':
    case 'IFLE':
    case 'IFGT':
    case 'IFGE':
      normalized.args = args.map((arg) =>
        arg.kind === 'int'
          ? { kind: 'target', value: arg.value }
          : arg
      );
      break;
    case 'GETSTATIC':
    case 'PUTSTATIC':
    case 'GETFIELD':
    case 'PUTFIELD':
      normalized.args = [parseFieldReference(comment, ownerClass || className || null)];
      break;
    case 'INVOKEVIRTUAL':
    case 'INVOKESTATIC':
    case 'INVOKESPECIAL':
    case 'INVOKEINTERFACE':
      normalized.args = [parseMethodReference(comment, ownerClass || className || null)];
      break;
    case 'NEW':
    case 'ANEWARRAY':
      normalized.args = [parseTypeReference(comment)];
      break;
    default:
      normalized.args = args;
  }

  return normalized;
}

function parseLdcValue(comment) {
  if (!comment) {
    return { kind: 'raw', value: null };
  }
  const stringMatch = /^String\s+(.*)$/.exec(comment);
  if (stringMatch) {
    return { kind: 'string', value: stringMatch[1] };
  }
  const intMatch = /^int\s+([-\d]+)$/.exec(comment);
  if (intMatch) {
    return { kind: 'int', value: Number(intMatch[1]) };
  }
  const floatMatch = /^float\s+([-\d\.eE]+)$/.exec(comment);
  if (floatMatch) {
    return { kind: 'float', value: Number(floatMatch[1]) };
  }
  const classMatch = /^class\s+([\w\./$]+)$/.exec(comment);
  if (classMatch) {
    return { kind: 'class', value: classMatch[1].replace(/\./g, '/') };
  }
  return { kind: 'raw', value: comment };
}

function parseFieldReference(comment, defaultClassName = null) {
  if (!comment) return { kind: 'raw', value: null };
  const match = /^Field\s+([^\.]+(?:\.[^\.]+)*)\.([^:]+):(.*)$/.exec(comment);
  if (!match) {
    const scopedMatch = /^Field\s+([^:]+):(.*)$/.exec(comment);
    if (scopedMatch && defaultClassName) {
      return {
        kind: 'field',
        className: defaultClassName,
        fieldName: scopedMatch[1],
        descriptor: scopedMatch[2].trim()
      };
    }
    return { kind: 'raw', value: comment };
  }
  return {
    kind: 'field',
    className: match[1].replace(/\./g, '/'),
    fieldName: match[2],
    descriptor: match[3].trim()
  };
}

function parseMethodReference(comment, defaultClassName = null) {
  if (!comment) return { kind: 'raw', value: null };
  const match = /^Method\s+([^\.]+(?:\.[^\.]+)*)\.([^:(]+):(.*)$/.exec(comment);
  if (!match) {
    const scopedMatch = /^Method\s+"?([^"\s]+)"?:(.*)$/.exec(comment);
    if (scopedMatch && defaultClassName) {
      return {
        kind: 'method',
        className: defaultClassName,
        methodName: scopedMatch[1],
        descriptor: scopedMatch[2].trim(),
      };
    }
    return { kind: 'raw', value: comment };
  }
  return {
    kind: 'method',
    className: match[1].replace(/\./g, '/'),
    methodName: match[2].replace(/"/g, ''),
    descriptor: match[3].trim()
  };
}

function parseTypeReference(comment) {
  if (!comment) return { kind: 'raw', value: null };
  const match = /class\s+([\w\./$]+)/i.exec(comment);
  if (!match) {
    return { kind: 'raw', value: comment };
  }
  return {
    kind: 'class',
    className: match[1].replace(/\./g, '/'),
  };
}

function buildMeta(comment) {
  if (!comment) return null;
  return { comment };
}
