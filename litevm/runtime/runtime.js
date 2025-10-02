export class LiteVMRuntime {
  static bootstrap(manifest) {
    return new LiteVMRuntime(manifest);
  }

  constructor(manifest) {
    this.classes = new Map();
    this.bridges = new Map();
    this.staticFields = new Map();

    for (const cls of manifest) {
      const normalizedName = cls.className.replace(/\\\\/g, '/');
      const methods = new Map();
      for (const method of cls.methods) {
        const key = this._methodKey(method.name, method.descriptor);
        methods.set(key, { ...method, instructions: method.instructions });
      }
      this.classes.set(normalizedName, { ...cls, methods });
    }
  }

  registerBridge(className, signature, handler) {
    this.bridges.set(this._bridgeKey(className, signature), handler);
  }

  invokeStatic(className, methodName, descriptor, args = []) {
    const method = this._lookupMethod(className, methodName, descriptor);
    if (!method) {
      throw new Error(`Unknown static method ${className}.${methodName}${descriptor}`);
    }
    return this._executeMethod({ method, args, instance: null });
  }

  _lookupClass(className) {
    const key = className.replace(/\\\\/g, '/');
    return this.classes.get(key) || null;
  }

  _lookupMethod(className, methodName, descriptor) {
    const cls = this._lookupClass(className);
    if (!cls) return null;
    return cls.methods.get(this._methodKey(methodName, descriptor)) || null;
  }

  _methodKey(name, descriptor) {
    return `${name}#${descriptor}`;
  }

  _bridgeKey(className, signature) {
    return `${className}#${signature}`;
  }

  _executeMethod({ method, args, instance }) {
    const frame = {
      method,
      locals: new Array(method.maxLocals).fill(null),
      stack: [],
      ip: 0,
      instance
    };

    let localIndex = 0;
    if (!method.flags.includes('ACC_STATIC')) {
      frame.locals[localIndex++] = instance;
    }

    for (const arg of args) {
      frame.locals[localIndex++] = arg;
    }

    while (frame.ip < method.instructions.length) {
      const instr = method.instructions[frame.ip];
      const result = this._dispatch(instr, frame);
      if (result && result.type === 'return') {
        return result.value;
      }
      frame.ip += 1;
    }

    return undefined;
  }

  _dispatch(instr, frame) {
    const { op, args = [] } = instr;
    switch (op) {
      case 'NOP':
        return;
      case 'ICONST':
      case 'BIPUSH':
      case 'SIPUSH': {
        const value = args[0]?.value ?? 0;
        frame.stack.push(value);
        return;
      }
      case 'LDC': {
        frame.stack.push(this._resolveLdc(args[0]));
        return;
      }
      case 'ILOAD': {
        const index = args[0]?.value ?? 0;
        frame.stack.push(frame.locals[index]);
        return;
      }
      case 'ISTORE': {
        const index = args[0]?.value ?? 0;
        const value = frame.stack.pop();
        frame.locals[index] = value;
        return;
      }
      case 'IINC': {
        const index = args[0]?.value ?? 0;
        const delta = args[1]?.value ?? 0;
        frame.locals[index] = (frame.locals[index] | 0) + delta;
        return;
      }
      case 'IADD':
      case 'ISUB':
      case 'IMUL':
      case 'IDIV':
      case 'IREM': {
        const b = frame.stack.pop() | 0;
        const a = frame.stack.pop() | 0;
        let result = 0;
        if (op === 'IADD') result = a + b;
        else if (op === 'ISUB') result = a - b;
        else if (op === 'IMUL') result = Math.imul(a, b);
        else if (op === 'IDIV') result = (a / b) | 0;
        else if (op === 'IREM') result = a % b;
        frame.stack.push(result);
        return;
      }
      case 'INEG': {
        const value = frame.stack.pop() | 0;
        frame.stack.push(-value);
        return;
      }
      case 'IAND':
      case 'IOR':
      case 'IXOR': {
        const b = frame.stack.pop() | 0;
        const a = frame.stack.pop() | 0;
        if (op === 'IAND') frame.stack.push(a & b);
        if (op === 'IOR') frame.stack.push(a | b);
        if (op === 'IXOR') frame.stack.push(a ^ b);
        return;
      }
      case 'POP': {
        frame.stack.pop();
        return;
      }
      case 'DUP': {
        const top = frame.stack.at(-1);
        frame.stack.push(top);
        return;
      }
      case 'GOTO': {
        const target = args[0]?.value ?? 0;
        frame.ip = target - 1;
        return;
      }
      case 'IF_ICMPEQ':
      case 'IF_ICMPNE':
      case 'IF_ICMPLT':
      case 'IF_ICMPLE':
      case 'IF_ICMPGT':
      case 'IF_ICMPGE': {
        const target = args[0]?.value ?? 0;
        const b = frame.stack.pop() | 0;
        const a = frame.stack.pop() | 0;
        let condition = false;
        if (op === 'IF_ICMPEQ') condition = a === b;
        else if (op === 'IF_ICMPNE') condition = a !== b;
        else if (op === 'IF_ICMPLT') condition = a < b;
        else if (op === 'IF_ICMPLE') condition = a <= b;
        else if (op === 'IF_ICMPGT') condition = a > b;
        else if (op === 'IF_ICMPGE') condition = a >= b;
        if (condition) {
          frame.ip = target - 1;
        }
        return;
      }
      case 'IFEQ':
      case 'IFNE':
      case 'IFLT':
      case 'IFLE':
      case 'IFGT':
      case 'IFGE': {
        const target = args[0]?.value ?? 0;
        const value = frame.stack.pop() | 0;
        let condition = false;
        if (op === 'IFEQ') condition = value === 0;
        else if (op === 'IFNE') condition = value !== 0;
        else if (op === 'IFLT') condition = value < 0;
        else if (op === 'IFLE') condition = value <= 0;
        else if (op === 'IFGT') condition = value > 0;
        else if (op === 'IFGE') condition = value >= 0;
        if (condition) {
          frame.ip = target - 1;
        }
        return;
      }
      case 'RETURN':
        return { type: 'return', value: undefined };
      case 'IRETURN':
      case 'ARETURN':
        return { type: 'return', value: frame.stack.pop() };
      case 'INVOKESTATIC': {
        const ref = args[0];
        const argCount = this._descriptorArgCount(ref.descriptor);
        const callArgs = [];
        for (let i = 0; i < argCount; i += 1) {
          callArgs.unshift(frame.stack.pop());
        }
        const bridgeKey = this._bridgeKey(ref.className, `${ref.methodName}:${ref.descriptor}`);
        const bridge = this.bridges.get(bridgeKey);
        if (bridge) {
          const value = bridge(callArgs);
          if (!this._isVoidDescriptor(ref.descriptor)) {
            frame.stack.push(value);
          }
          return;
        }
        const targetMethod = this._lookupMethod(ref.className, ref.methodName, ref.descriptor);
        if (!targetMethod) {
          throw new Error(`Missing static target ${ref.className}.${ref.methodName}${ref.descriptor}`);
        }
        const result = this._executeMethod({ method: targetMethod, args: callArgs, instance: null });
        if (!this._isVoidDescriptor(ref.descriptor)) {
          frame.stack.push(result);
        }
        return;
      }
      case 'INVOKEVIRTUAL': {
        const ref = args[0];
        const argCount = this._descriptorArgCount(ref.descriptor);
        const callArgs = [];
        for (let i = 0; i < argCount; i += 1) {
          callArgs.unshift(frame.stack.pop());
        }
        const instance = frame.stack.pop();
        const bridgeKey = this._bridgeKey(ref.className, `${ref.methodName}:${ref.descriptor}`);
        const bridge = this.bridges.get(bridgeKey);
        if (!bridge) {
          throw new Error(`No bridge registered for virtual call ${ref.className}.${ref.methodName}${ref.descriptor}`);
        }
        const value = bridge(instance, callArgs);
        if (!this._isVoidDescriptor(ref.descriptor)) {
          frame.stack.push(value);
        }
        return;
      }
      default:
        throw new Error(`Unsupported opcode: ${op}`);
    }
  }

  _resolveLdc(arg) {
    if (!arg) return null;
    switch (arg.kind) {
      case 'string':
      case 'int':
      case 'float':
        return arg.value;
      case 'class':
        return { __classLiteral: arg.value };
      default:
        return arg.value;
    }
  }

  _descriptorArgCount(descriptor) {
    let index = 1;
    let count = 0;
    while (descriptor[index] !== ')') {
      const char = descriptor[index];
      if (char === 'L') {
        index += 1;
        while (descriptor[index] !== ';') {
          index += 1;
        }
        index += 1;
        count += 1;
      } else if (char === '[') {
        do {
          index += 1;
        } while (descriptor[index] === '[');
        if (descriptor[index] === 'L') {
          index += 1;
          while (descriptor[index] !== ';') index += 1;
          index += 1;
        } else {
          index += 1;
        }
        count += 1;
      } else {
        index += 1;
        count += 1;
      }
    }
    return count;
  }

  _isVoidDescriptor(descriptor) {
    return descriptor.endsWith(')V');
  }
}
