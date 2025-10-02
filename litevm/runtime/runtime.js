export class LiteVMRuntime {
  static bootstrap(manifest) {
    return new LiteVMRuntime(manifest);
  }

  constructor(manifest) {
    this.classes = new Map();
    this.bridges = new Map();
    this.staticFields = new Map();
    this.heap = new Map();
    this.nextObjectId = 1;

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

  invokeVirtual(className, methodName, descriptor, instance, args = []) {
    const method = this._resolveVirtualTarget(
      instance?.__litevmClass || className,
      className,
      methodName,
      descriptor,
    );
    if (!method) {
      throw new Error(`Unknown virtual method ${className}.${methodName}${descriptor}`);
    }
    return this._executeMethod({ method, args, instance });
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
    let cls = this._lookupClass(className);
    const key = this._methodKey(methodName, descriptor);
    while (cls) {
      const method = cls.methods.get(key);
      if (method) {
        return method;
      }
      if (!cls.superName || cls.superName === cls.className) {
        break;
      }
      cls = this._lookupClass(cls.superName);
    }
    return null;
  }

  _resolveVirtualTarget(instanceClassName, declaredClassName, methodName, descriptor) {
    if (instanceClassName) {
      const method = this._lookupMethod(instanceClassName, methodName, descriptor);
      if (method) {
        return method;
      }
    }
    if (declaredClassName && declaredClassName !== instanceClassName) {
      const method = this._lookupMethod(declaredClassName, methodName, descriptor);
      if (method) {
        return method;
      }
    }
    return null;
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
      case 'ACONST_NULL':
        frame.stack.push(null);
        return;
      case 'ACONST_NULL':
        frame.stack.push(null);
        return;
      case 'ICONST':
      case 'BIPUSH':
      case 'SIPUSH': {
        const value = args[0]?.value ?? 0;
        frame.stack.push(value);
        return;
      }
      case 'NEW': {
        const ref = args[0];
        const object = this._allocateObject(ref?.className || 'java/lang/Object');
        frame.stack.push(object);
        return;
      }
      case 'NEWARRAY': {
        const length = frame.stack.pop() | 0;
        const typeInfo = args[0];
        const descriptor = typeInfo?.descriptor || this._descriptorFromPrimitiveToken(typeInfo?.token || typeInfo?.value || 'int');
        const array = this._allocateArray(descriptor, length);
        frame.stack.push(array);
        return;
      }
      case 'ANEWARRAY': {
        const length = frame.stack.pop() | 0;
        const typeInfo = args[0];
        const descriptor = typeInfo?.descriptor || 'Ljava/lang/Object;';
        const array = this._allocateArray(descriptor, length);
        frame.stack.push(array);
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
      case 'ALOAD': {
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
      case 'ASTORE': {
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
      case 'GETSTATIC': {
        const ref = args[0];
        frame.stack.push(this._getStaticField(ref));
        return;
      }
      case 'PUTSTATIC': {
        const ref = args[0];
        const value = frame.stack.pop();
        this._setStaticField(ref, value);
        return;
      }
      case 'GETFIELD': {
        const ref = args[0];
        const instance = frame.stack.pop();
        frame.stack.push(this._getInstanceField(instance, ref));
        return;
      }
      case 'PUTFIELD': {
        const ref = args[0];
        const value = frame.stack.pop();
        const instance = frame.stack.pop();
        this._setInstanceField(instance, ref, value);
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
      case 'ARRAYLENGTH': {
        const arrayRef = frame.stack.pop();
        frame.stack.push(this._arrayLength(arrayRef));
        return;
      }
      case 'IALOAD':
      case 'LALOAD':
      case 'FALOAD':
      case 'DALOAD':
      case 'BALOAD':
      case 'CALOAD':
      case 'SALOAD':
      case 'AALOAD': {
        const index = frame.stack.pop() | 0;
        const arrayRef = frame.stack.pop();
        const value = this._arrayLoad(arrayRef, this._arrayOpType(op), index);
        frame.stack.push(value);
        return;
      }
      case 'IASTORE':
      case 'LASTORE':
      case 'FASTORE':
      case 'DASTORE':
      case 'BASTORE':
      case 'CASTORE':
      case 'SASTORE':
      case 'AASTORE': {
        const value = frame.stack.pop();
        const index = frame.stack.pop() | 0;
        const arrayRef = frame.stack.pop();
        this._arrayStore(arrayRef, this._arrayOpType(op), index, value);
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
        const targetMethod = this._resolveVirtualTarget(
          instance?.__litevmClass || ref.className,
          ref.className,
          ref.methodName,
          ref.descriptor,
        );
        let value;
        if (targetMethod) {
          value = this._executeMethod({ method: targetMethod, args: callArgs, instance });
        } else {
          const bridgeKey = this._bridgeKey(ref.className, `${ref.methodName}:${ref.descriptor}`);
          const bridge = this.bridges.get(bridgeKey);
          if (!bridge) {
            throw new Error(`No target found for virtual call ${ref.className}.${ref.methodName}${ref.descriptor}`);
          }
          value = bridge(instance, callArgs);
        }
        if (!this._isVoidDescriptor(ref.descriptor)) {
          frame.stack.push(value);
        }
        return;
      }
      case 'INVOKESPECIAL': {
        const ref = args[0];
        const argCount = this._descriptorArgCount(ref.descriptor);
        const callArgs = [];
        for (let i = 0; i < argCount; i += 1) {
          callArgs.unshift(frame.stack.pop());
        }
        const instance = frame.stack.pop();
        const targetMethod = this._lookupMethod(ref.className, ref.methodName, ref.descriptor);
        if (!targetMethod) {
          if (ref.className === 'java/lang/Object' && ref.methodName === '<init>') {
            return;
          }
          throw new Error(`Missing special target ${ref.className}.${ref.methodName}${ref.descriptor}`);
        }
        const result = this._executeMethod({ method: targetMethod, args: callArgs, instance });
        if (!this._isVoidDescriptor(ref.descriptor)) {
          frame.stack.push(result);
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

  _allocateObject(className) {
    const id = this.nextObjectId++;
    const object = {
      __litevmId: id,
      __litevmClass: className,
      fields: Object.create(null),
    };
    this.heap.set(id, object);
    return object;
  }

  _fieldKey(ref) {
    if (!ref) return 'unknown#field';
    return `${ref.className || 'unknown'}#${ref.fieldName || 'field'}`;
  }

  _getStaticField(ref) {
    const key = this._fieldKey(ref);
    if (!this.staticFields.has(key)) {
      this.staticFields.set(key, this._defaultValue(ref?.descriptor));
    }
    return this.staticFields.get(key);
  }

  _setStaticField(ref, value) {
    const key = this._fieldKey(ref);
    this.staticFields.set(key, value);
  }

  _assertInstance(instance) {
    if (!instance || typeof instance !== 'object' || !('__litevmClass' in instance)) {
      throw new Error('Attempted to access field on non-object value');
    }
  }

  _getInstanceField(instance, ref) {
    this._assertInstance(instance);
    const fieldName = ref?.fieldName;
    const descriptor = ref?.descriptor;
    if (!(fieldName in instance.fields)) {
      instance.fields[fieldName] = this._defaultValue(descriptor);
    }
    return instance.fields[fieldName];
  }

  _setInstanceField(instance, ref, value) {
    this._assertInstance(instance);
    const fieldName = ref?.fieldName;
    instance.fields[fieldName] = value;
  }

  _defaultValue(descriptor = 'Ljava/lang/Object;') {
    if (!descriptor) return null;
    const typeChar = descriptor[0];
    switch (typeChar) {
      case 'Z': // boolean
      case 'B': // byte
      case 'C': // char
      case 'S': // short
      case 'I':
        return 0;
      case 'J':
        return 0n;
      case 'F':
      case 'D':
        return 0;
      default:
        return null;
    }
  }

  _descriptorFromPrimitiveToken(token = 'int') {
    switch (String(token).toLowerCase()) {
      case 'boolean':
        return 'Z';
      case 'byte':
        return 'B';
      case 'char':
        return 'C';
      case 'short':
        return 'S';
      case 'long':
        return 'J';
      case 'float':
        return 'F';
      case 'double':
        return 'D';
      default:
        return 'I';
    }
  }

  _allocateArray(componentDescriptor, length) {
    if (length < 0) {
      throw new Error('Negative array size');
    }
    const id = this.nextObjectId++;
    const defaultValue = this._defaultValue(componentDescriptor);
    const data = new Array(length).fill(defaultValue);
    const array = {
      __litevmId: id,
      __litevmArray: true,
      componentType: componentDescriptor,
      length,
      data,
    };
    this.heap.set(id, array);
    return array;
  }

  _assertArray(ref) {
    if (!ref || typeof ref !== 'object' || !ref.__litevmArray) {
      throw new Error('Array reference expected');
    }
  }

  _arrayLength(ref) {
    this._assertArray(ref);
    return ref.length;
  }

  _arrayLoad(ref, type, index) {
    const array = this._ensureArrayBounds(ref, index);
    const value = array.data[index];
    if (type === 'I' || type === 'B' || type === 'S' || type === 'C') {
      return value | 0;
    }
    if (type === 'Z') {
      return value ? 1 : 0;
    }
    return value;
  }

  _arrayStore(ref, type, index, value) {
    const array = this._ensureArrayBounds(ref, index);
    array.data[index] = this._coerceArrayValue(type, value);
  }

  _ensureArrayBounds(ref, index) {
    this._assertArray(ref);
    if (index < 0 || index >= ref.length) {
      throw new Error('Array index out of bounds');
    }
    return ref;
  }

  _coerceArrayValue(type, value) {
    switch (type) {
      case 'I':
      case 'S':
      case 'C':
        return value | 0;
      case 'B':
        return (value | 0) & 0xff;
      case 'Z':
        return value ? 1 : 0;
      case 'J':
        return typeof value === 'bigint' ? value : BigInt(value || 0);
      case 'F':
      case 'D':
        return Number(value);
      case 'A':
      default:
        return value;
    }
  }

  _arrayOpType(op) {
    switch (op) {
      case 'IALOAD':
      case 'IASTORE':
        return 'I';
      case 'LALOAD':
      case 'LASTORE':
        return 'J';
      case 'FALOAD':
      case 'FASTORE':
        return 'F';
      case 'DALOAD':
      case 'DASTORE':
        return 'D';
      case 'BALOAD':
      case 'BASTORE':
        return 'B';
      case 'SALOAD':
      case 'SASTORE':
        return 'S';
      case 'CALOAD':
      case 'CASTORE':
        return 'C';
      case 'AALOAD':
      case 'AASTORE':
      default:
        return 'A';
    }
  }
}
