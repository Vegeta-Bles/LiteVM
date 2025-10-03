const THROW_FLAG = Symbol('litevm.throw');

const KIND = {
  INT: 'int',
  LONG: 'long',
  FLOAT: 'float',
  DOUBLE: 'double',
  REF: 'ref',
  VOID: 'void',
};

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
    this.classMetadata = new Map();

    for (const cls of manifest) {
      const normalizedName = this._normalizeClassName(cls.className);
      const methods = new Map();
      const methodMetadata = [];
      for (const method of cls.methods) {
        const key = this._methodKey(method.name, method.descriptor);
        methods.set(key, { ...method, instructions: method.instructions });
        methodMetadata.push({
          name: method.name,
          descriptor: method.descriptor,
          flags: method.flags,
        });
      }
      const fieldMetadata = (cls.fields || []).map((field) => ({
        name: field.name,
        descriptor: field.descriptor,
        flags: field.flags || [],
      }));
      this.classes.set(normalizedName, { ...cls, methods });
      this.classMetadata.set(normalizedName, {
        className: normalizedName,
        superName: cls.superName,
        methods: methodMetadata,
        fields: fieldMetadata,
      });
    }
  }

  registerBridge(className, signature, handler) {
    this.bridges.set(this._bridgeKey(className, signature), handler);
  }

  listClasses() {
    return Array.from(this.classMetadata.keys());
  }

  getClassMetadata(className) {
    const key = this._normalizeClassName(className);
    const metadata = this.classMetadata.get(key);
    if (!metadata) return null;
    return {
      className: metadata.className,
      superName: metadata.superName,
      methods: metadata.methods.map((method) => ({ ...method })),
      fields: metadata.fields.map((field) => ({ ...field })),
    };
  }

  invokeStatic(className, methodName, descriptor, rawArgs = []) {
    const method = this._lookupMethod(className, methodName, descriptor);
    if (!method) {
      throw new Error(`Unknown static method ${className}.${methodName}${descriptor}`);
    }
    const wrappedArgs = this._wrapArgsFromDescriptor(descriptor, rawArgs);
    const result = this._executeMethod({ method, args: wrappedArgs, instance: null });
    if (this._isThrowResult(result)) {
      throw this._toHostError(result.value);
    }
    return result;
  }

  invokeVirtual(className, methodName, descriptor, instance, rawArgs = []) {
    const target = this._resolveVirtualTarget(
      instance?.__litevmClass || className,
      className,
      methodName,
      descriptor,
    );
    if (!target) {
      throw new Error(`Unknown virtual method ${className}.${methodName}${descriptor}`);
    }
    const wrappedArgs = this._wrapArgsFromDescriptor(descriptor, rawArgs);
    const instanceWrapper = this._wrapRef(instance);
    const result = this._executeMethod({ method: target, args: wrappedArgs, instance: instanceWrapper });
    if (this._isThrowResult(result)) {
      throw this._toHostError(result.value);
    }
    return result;
  }

  _executeMethod({ method, args, instance }) {
    const frame = {
      method,
      locals: new Array(method.maxLocals).fill(null),
      stack: [],
      ip: 0,
      handlers: method.exceptionHandlers || [],
    };

    let localIndex = 0;
    if (!method.flags.includes('ACC_STATIC')) {
      this._setLocal(frame, localIndex++, instance || this._wrapRef(null));
    }

    for (const arg of args) {
      this._setLocal(frame, localIndex++, arg);
    }

    while (frame.ip < method.instructions.length) {
      const instr = method.instructions[frame.ip];
      const result = this._dispatch(instr, frame);
      if (result) {
        if (result.type === 'return') {
          return this._unwrapValue(result.value);
        }
        if (result.type === 'throw') {
          if (this._handleException(frame, result.value)) {
            continue;
          }
          return this._throwResult(result.value);
        }
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
        this._pushRef(frame, null);
        return;
      case 'ICONST':
      case 'BIPUSH':
      case 'SIPUSH': {
        const value = args[0]?.value ?? 0;
        this._pushInt(frame, value);
        return;
      }
      case 'LDC': {
        const constant = this._resolveLdc(args[0]);
        this._pushValue(frame, constant);
        return;
      }
      case 'NEW': {
        const ref = args[0];
        const object = this._allocateObject(ref?.className || 'java/lang/Object');
        this._pushRef(frame, object);
        return;
      }
      case 'NEWARRAY': {
        const length = this._popInt(frame);
        const typeInfo = args[0];
        const descriptor = typeInfo?.descriptor || this._descriptorFromPrimitiveToken(typeInfo?.token || 'int');
        this._pushRef(frame, this._allocateArray(descriptor, length));
        return;
      }
      case 'ANEWARRAY': {
        const length = this._popInt(frame);
        const typeInfo = args[0];
        const className = typeInfo?.className || 'java/lang/Object';
        const descriptor = typeInfo?.descriptor || `L${className};`;
        this._pushRef(frame, this._allocateArray(descriptor, length));
        return;
      }
      case 'ILOAD': {
        const index = args[0]?.value ?? 0;
        const value = this._cloneValue(this._getLocal(frame, index) || this._wrapInt(0));
        this._pushValue(frame, value);
        return;
      }
      case 'ALOAD': {
        const index = args[0]?.value ?? 0;
        const value = this._cloneValue(this._getLocal(frame, index) || this._wrapRef(null));
        this._pushValue(frame, value);
        return;
      }
     case 'ISTORE': {
        const index = args[0]?.value ?? 0;
        if (index === 0) {
          console.warn('Debug ISTORE index 0');
        }
        this._setLocal(frame, index, this._popValue(frame));
        return;
      }
      case 'ASTORE': {
        const index = args[0]?.value ?? 0;
        if (index === 0) {
          console.warn('Debug ASTORE index 0');
        }
        this._setLocal(frame, index, this._popValue(frame));
        return;
      }
      case 'IINC': {
        const index = args[0]?.value ?? 0;
        const delta = args[1]?.value ?? 0;
        const current = this._unwrapInt(this._getLocal(frame, index));
        this._setLocal(frame, index, this._wrapInt(current + delta));
        return;
      }
     case 'IADD':
     case 'ISUB':
     case 'IMUL':
     case 'IDIV':
     case 'IREM': {
        console.warn(`Debug ${op} stack size before: ${frame.stack.length}`);
        const b = this._popInt(frame);
        const a = this._popInt(frame);
        let result = 0;
        if (op === 'IADD') result = a + b;
        else if (op === 'ISUB') result = a - b;
        else if (op === 'IMUL') result = Math.imul(a, b);
        else if (op === 'IDIV') {
          if (b === 0) {
            return { type: 'throw', value: this._instantiateBuiltinException('java/lang/ArithmeticException', 'Division by zero') };
          }
          result = (a / b) | 0;
        } else if (op === 'IREM') {
          if (b === 0) {
            return { type: 'throw', value: this._instantiateBuiltinException('java/lang/ArithmeticException', 'Division by zero') };
          }
          result = a % b;
        }
        this._pushInt(frame, result);
        console.warn(`Debug ${op} stack size after: ${frame.stack.length}`);
        return;
      }
      case 'GETSTATIC': {
        const ref = args[0];
        const raw = this._getStaticField(ref);
        this._pushValue(frame, this._wrapFromType(ref.descriptor, raw));
        return;
      }
      case 'PUTSTATIC': {
        const ref = args[0];
        const value = this._unwrapValue(this._popValue(frame));
        this._setStaticField(ref, value);
        return;
      }
      case 'GETFIELD': {
        const ref = args[0];
        const instance = this._popRef(frame);
        const raw = this._getInstanceField(instance, ref);
        this._pushValue(frame, this._wrapFromType(ref.descriptor, raw));
        return;
      }
      case 'PUTFIELD': {
        const ref = args[0];
        const value = this._unwrapValue(this._popValue(frame));
        const instance = this._popRef(frame);
        this._setInstanceField(instance, ref, value);
        return;
      }
      case 'INEG': {
        const value = this._popInt(frame);
        this._pushInt(frame, -value);
        return;
      }
      case 'IAND':
      case 'IOR':
      case 'IXOR': {
        const b = this._popInt(frame);
        const a = this._popInt(frame);
        if (op === 'IAND') this._pushInt(frame, a & b);
        else if (op === 'IOR') this._pushInt(frame, a | b);
        else this._pushInt(frame, a ^ b);
        return;
      }
      case 'POP':
        this._popValue(frame);
        return;
      case 'DUP': {
        const top = this._peekValue(frame);
        this._pushValue(frame, top);
        return;
      }
      case 'ARRAYLENGTH': {
        const arrayRef = this._popRef(frame);
        this._pushInt(frame, this._arrayLength(arrayRef));
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
        const index = this._popInt(frame);
        const arrayRef = this._popRef(frame);
        const component = this._arrayOpType(op);
        const raw = this._arrayLoad(arrayRef, component, index);
        this._pushValue(frame, this._wrapComponent(component, raw));
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
        const component = this._arrayOpType(op);
        const value = this._unwrapValue(this._popValue(frame));
        const index = this._popInt(frame);
        const arrayRef = this._popRef(frame);
        this._arrayStore(arrayRef, component, index, value);
        return;
      }
      case 'ATHROW': {
        const throwable = this._popRef(frame);
        if (!throwable) {
          return { type: 'throw', value: this._instantiateBuiltinException('java/lang/NullPointerException', 'Throwing null') };
        }
        return { type: 'throw', value: throwable };
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
        const b = this._popInt(frame);
        const a = this._popInt(frame);
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
        const value = this._popInt(frame);
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
        return { type: 'return', value: this._wrapVoid() };
      case 'IRETURN':
      case 'ARETURN':
        return { type: 'return', value: this._popValue(frame) };
      case 'INVOKESTATIC': {
        const ref = args[0];
        const callArgs = this._collectCallArguments(frame, ref.descriptor);
        const bridgeKey = this._bridgeKey(ref.className, `${ref.methodName}:${ref.descriptor}`);
        const bridge = this.bridges.get(bridgeKey);
        if (bridge) {
          const rawArgs = callArgs.map((arg) => this._unwrapValue(arg));
          const value = bridge(rawArgs);
          this._pushReturnValue(frame, ref.descriptor, value);
          return;
        }
        const targetMethod = this._lookupMethod(ref.className, ref.methodName, ref.descriptor);
        if (!targetMethod) {
          throw new Error(`Missing static target ${ref.className}.${ref.methodName}${ref.descriptor}`);
        }
        const result = this._executeMethod({
          method: targetMethod,
          args: callArgs.map((arg) => this._cloneValue(arg)),
          instance: null,
        });
        if (this._isThrowResult(result)) {
          return result;
        }
        this._pushReturnValue(frame, ref.descriptor, result);
        return;
      }
      case 'INVOKEVIRTUAL': {
        const ref = args[0];
        const callArgs = this._collectCallArguments(frame, ref.descriptor);
        const instance = this._popRef(frame);
        const bridgeKey = this._bridgeKey(ref.className, `${ref.methodName}:${ref.descriptor}`);
        const bridge = this.bridges.get(bridgeKey);
        if (bridge) {
          const rawArgs = callArgs.map((arg) => this._unwrapValue(arg));
          const value = bridge(instance, rawArgs);
          this._pushReturnValue(frame, ref.descriptor, value);
          return;
        }
        const targetMethod = this._resolveVirtualTarget(
          instance?.__litevmClass || ref.className,
          ref.className,
          ref.methodName,
          ref.descriptor,
        );
        if (!targetMethod) {
          throw new Error(`No target found for virtual call ${ref.className}.${ref.methodName}${ref.descriptor}`);
        }
        const result = this._executeMethod({
          method: targetMethod,
          args: callArgs.map((arg) => this._cloneValue(arg)),
          instance: this._wrapRef(instance),
        });
        if (this._isThrowResult(result)) {
          return result;
        }
        this._pushReturnValue(frame, ref.descriptor, result);
        return;
      }
      case 'INVOKESPECIAL': {
        const ref = args[0];
        const callArgs = this._collectCallArguments(frame, ref.descriptor);
        const instance = this._popRef(frame);
        const targetMethod = this._lookupMethod(ref.className, ref.methodName, ref.descriptor);
        if (!targetMethod) {
          if (ref.className === 'java/lang/Object' && ref.methodName === '<init>') {
            return;
          }
          throw new Error(`Missing special target ${ref.className}.${ref.methodName}${ref.descriptor}`);
        }
        const result = this._executeMethod({
          method: targetMethod,
          args: callArgs.map((arg) => this._cloneValue(arg)),
          instance: this._wrapRef(instance),
        });
        if (this._isThrowResult(result)) {
          return result;
        }
        this._pushReturnValue(frame, ref.descriptor, result);
        return;
      }
      default:
        throw new Error(`Unsupported opcode: ${op}`);
    }
  }

  _resolveLdc(arg) {
    if (!arg) {
      return this._wrapRef(null);
    }
    switch (arg.kind) {
      case 'string':
        return this._wrapRef(arg.value);
      case 'int':
        return this._wrapInt(arg.value);
      case 'float':
        return this._wrapFloat(arg.value);
      case 'class':
        return this._wrapRef({ __classLiteral: arg.value });
      default:
        return this._wrapRef(arg.value ?? null);
    }
  }

  _handleException(frame, throwable) {
    const handlers = frame.handlers || [];
    for (const handler of handlers) {
      if (frame.ip >= handler.start && frame.ip < handler.end) {
        if (!handler.type || this._isInstanceOf(throwable, handler.type)) {
          frame.stack = [this._wrapRef(throwable)];
          frame.ip = handler.handler;
          return true;
        }
      }
    }
    return false;
  }

  _isInstanceOf(value, targetClass) {
    if (!targetClass) return true;
    if (!value || typeof value !== 'object') return false;
    if (targetClass === 'java/lang/Object') return true;
    let current = value.__litevmClass;
    while (current) {
      if (current === targetClass) {
        return true;
      }
      const cls = this._lookupClass(current);
      if (!cls || !cls.superName || cls.superName === current) {
        break;
      }
      current = cls.superName;
    }
    return false;
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

  _assertInstance(instance) {
    if (!instance || typeof instance !== 'object' || !('__litevmClass' in instance)) {
      throw new Error('Attempted to access field on non-object value');
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

  _assertArray(ref) {
    if (!ref || typeof ref !== 'object' || !ref.__litevmArray) {
      throw new Error('Array reference expected');
    }
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
        return Math.fround(value ?? 0);
      case 'D':
        return Number(value ?? 0);
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

  _defaultValue(descriptor = 'Ljava/lang/Object;') {
    if (!descriptor) return null;
    const kind = this._descriptorToKind(descriptor);
    switch (kind) {
      case KIND.INT:
        return 0;
      case KIND.LONG:
        return 0n;
      case KIND.FLOAT:
      case KIND.DOUBLE:
        return 0;
      default:
        return null;
    }
  }

  _instantiateBuiltinException(className, message = '') {
    const exception = this._allocateObject(className);
    exception.fields.message = message;
    exception.fields.detailMessage = message;
    return exception;
  }

  _collectCallArguments(frame, descriptor) {
    const argTypes = this._parseArgumentTypes(descriptor);
    const args = new Array(argTypes.length);
    console.warn(`Debug collect args for ${descriptor} stack size ${frame.stack.length}`);
    for (let i = argTypes.length - 1; i >= 0; i -= 1) {
      const expectedKind = this._descriptorToKind(argTypes[i]);
      const value = this._popValue(frame);
      args[i] = this._convertValueToKind(value, expectedKind);
    }
    return args;
  }

  _wrapArgsFromDescriptor(descriptor, rawArgs) {
    const argTypes = this._parseArgumentTypes(descriptor);
    if (argTypes.length !== rawArgs.length) {
      throw new Error(`Expected ${argTypes.length} arguments but received ${rawArgs.length}`);
    }
    return argTypes.map((type, index) => this._wrapFromType(type, rawArgs[index]));
  }

  _pushReturnValue(frame, descriptor, rawValue) {
    const returnType = this._descriptorReturnType(descriptor);
    if (returnType === 'V') {
      return;
    }
    this._pushValue(frame, this._wrapFromType(returnType, rawValue));
  }

  _wrapFromType(typeDescriptor, rawValue) {
    const kind = this._descriptorToKind(typeDescriptor);
    return this._wrapKind(kind, rawValue);
  }

  _wrapComponent(componentType, rawValue) {
    switch (componentType) {
      case 'I':
      case 'S':
      case 'C':
      case 'B':
      case 'Z':
        return this._wrapInt(rawValue);
      case 'J':
        return this._wrapLong(rawValue);
      case 'F':
        return this._wrapFloat(rawValue);
      case 'D':
        return this._wrapDouble(rawValue);
      default:
        return this._wrapRef(rawValue);
    }
  }

  _pushValue(frame, value) {
    frame.stack.push(this._cloneValue(value));
  }

  _pushInt(frame, value) {
    this._pushValue(frame, this._wrapInt(value));
  }

  _pushRef(frame, value) {
    this._pushValue(frame, this._wrapRef(value));
  }

  _popValue(frame) {
    if (!frame.stack.length) {
      throw new Error('Stack underflow');
    }
    return frame.stack.pop();
  }

  _peekValue(frame) {
    if (!frame.stack.length) {
      throw new Error('Stack underflow');
    }
    return frame.stack[frame.stack.length - 1];
  }

  _popInt(frame) {
    return this._unwrapInt(this._popValue(frame));
  }

  _popRef(frame) {
    const value = this._popValue(frame);
    if (value.kind !== KIND.REF) {
      throw new Error(`Expected reference on stack, found ${value.kind}`);
    }
    return value.value;
  }

  _wrapInt(value) {
    return { kind: KIND.INT, value: (value | 0) };

  }

  _wrapFloat(value) {
    return { kind: KIND.FLOAT, value: Math.fround(value ?? 0) };
  }

  _wrapDouble(value) {
    return { kind: KIND.DOUBLE, value: Number(value ?? 0) };
  }

  _wrapLong(value) {
    const longValue = typeof value === 'bigint' ? value : BigInt(value ?? 0);
    return { kind: KIND.LONG, value: longValue };
  }

  _wrapRef(value) {
    return { kind: KIND.REF, value: value ?? null };
  }

  _wrapVoid() {
    return { kind: KIND.VOID, value: undefined };
  }

  _wrapKind(kind, value) {
    switch (kind) {
      case KIND.INT:
        return this._wrapInt(value);
      case KIND.FLOAT:
        return this._wrapFloat(value);
      case KIND.DOUBLE:
        return this._wrapDouble(value);
      case KIND.LONG:
        return this._wrapLong(value);
      case KIND.REF:
        return this._wrapRef(value);
      case KIND.VOID:
        return this._wrapVoid();
      default:
        return this._wrapRef(value);
    }
  }

  _cloneValue(value) {
    if (!value) {
      return this._wrapRef(null);
    }
    if (value.kind === KIND.REF) {
      return { kind: KIND.REF, value: value.value };
    }
    return { kind: value.kind, value: value.value };
  }

  _unwrapValue(value) {
    if (!value) return null;
    switch (value.kind) {
      case KIND.INT:
        return value.value | 0;
      case KIND.FLOAT:
      case KIND.DOUBLE:
        return Number(value.value);
      case KIND.LONG:
        return value.value;
      case KIND.REF:
        return value.value;
      case KIND.VOID:
        return undefined;
      default:
        return value.value;
    }
  }

  _unwrapInt(value) {
    if (!value) return 0;
    switch (value.kind) {
      case KIND.INT:
        return value.value | 0;
      case KIND.FLOAT:
      case KIND.DOUBLE:
        return Number(value.value) | 0;
      case KIND.LONG:
        return Number(value.value) | 0;
      default:
        return 0;
    }
  }

  _convertValueToKind(value, kind) {
    if (!value) {
      return this._wrapKind(kind, null);
    }
    if (value.kind === kind) {
      return this._cloneValue(value);
    }
    const raw = this._unwrapValue(value);
    switch (kind) {
      case KIND.INT:
        return this._wrapInt(raw);
      case KIND.FLOAT:
        return this._wrapFloat(raw);
      case KIND.DOUBLE:
        return this._wrapDouble(raw);
      case KIND.LONG:
        return this._wrapLong(raw);
      case KIND.REF:
        if (value.kind !== KIND.REF) {
          throw new Error('Expected reference value');
        }
        return this._cloneValue(value);
      default:
        return this._cloneValue(value);
    }
  }

  _setLocal(frame, index, value) {
    const cloned = this._cloneValue(value);
    frame.locals[index] = cloned;
    if (index === 0 && cloned.kind !== KIND.REF) {
      console.warn(`Debug: local[0] set to kind ${cloned.kind}`);
    }
  }

  _getLocal(frame, index) {
    return frame.locals[index] || null;
  }

  _descriptorArgCount(descriptor) {
    return this._parseArgumentTypes(descriptor).length;
  }

  _parseArgumentTypes(descriptor) {
    const types = [];
    let index = descriptor.indexOf('(') + 1;
    while (descriptor[index] !== ')') {
      let start = index;
      while (descriptor[index] === '[') index += 1;
      if (descriptor[index] === 'L') {
        while (descriptor[index] !== ';') index += 1;
        index += 1;
      } else {
        index += 1;
      }
      types.push(descriptor.slice(start, index));
    }
    return types;
  }

  _descriptorReturnType(descriptor) {
    const idx = descriptor.indexOf(')');
    return descriptor.slice(idx + 1);
  }

  _descriptorToKind(type) {
    if (!type || type === 'V') return KIND.VOID;
    if (type[0] === '[') return KIND.REF;
    let index = 0;
    while (type[index] === '[') index += 1;
    const char = type[index];
    switch (char) {
      case 'Z':
      case 'B':
      case 'C':
      case 'S':
      case 'I':
        return KIND.INT;
      case 'J':
        return KIND.LONG;
      case 'F':
        return KIND.FLOAT;
      case 'D':
        return KIND.DOUBLE;
      case 'V':
        return KIND.VOID;
      default:
        return KIND.REF;
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

  _isVoidDescriptor(descriptor) {
    return this._descriptorReturnType(descriptor) === 'V';
  }

  _isThrowResult(result) {
    return Boolean(result && typeof result === 'object' && result[THROW_FLAG]);
  }

  _throwResult(value) {
    return { [THROW_FLAG]: true, value };
  }

  _toHostError(throwable) {
    const className = throwable?.__litevmClass || 'java/lang/Throwable';
    const message = throwable?.fields?.message ?? throwable?.message ?? '';
    const error = new Error(`Uncaught Java exception ${className}${message ? `: ${message}` : ''}`);
    error.javaException = throwable;
    return error;
  }

  _normalizeClassName(className) {
    return className.replace(/[.\\\\]/g, '/');
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

  _lookupClass(className) {
    const key = this._normalizeClassName(className);
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

  _methodKey(name, descriptor) {
    return `${name}#${descriptor}`;
  }

  _bridgeKey(className, signature) {
    return `${className}#${signature}`;
  }
}
