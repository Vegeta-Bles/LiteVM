# LiteVM Architecture

LiteVM follows a three-stage pipeline:

1. **Discovery** – The CLI invokes the host `jar` tool to enumerate `.class` entries inside the supplied archive. Inner classes are preserved.
2. **Disassembly** – Each class is disassembled lazily using `javap -classpath <jar> -c -verbose <class>`. The textual output is parsed into a high-level intermediate representation (IR) that captures constant pool references, fields, and per-method instruction streams.
3. **Emission** – The IR is serialized into a JavaScript module. A micro-runtime (`runtime/runtime.js`) provides a stack machine that evaluates IR instructions at runtime, mirroring the JVM execution model for the supported opcode subset.

## Intermediate Representation

The IR is JSON-friendly and structured per class:

- `className`: fully qualified name (`java/lang/Object`).
- `superName`: optional parent class (defaults to `java/lang/Object`).
- `methods`: array of methods with `name`, `descriptor`, `maxStack`, `maxLocals`, and `instructions`.
- `instructions`: array of `{ op: string, args: any[] }` tuples, enriched with metadata extracted from `javap` comments.

Example snippet:

```json
{
  "className": "demo/Main",
  "methods": [
    {
      "name": "add",
      "descriptor": "(II)I",
      "maxStack": 2,
      "maxLocals": 2,
      "instructions": [
        { "op": "ILOAD", "args": [{ "kind": "int", "value": 0 }] },
        { "op": "ILOAD", "args": [{ "kind": "int", "value": 1 }] },
        { "op": "IADD", "args": [] },
        { "op": "IRETURN", "args": [] }
      ]
    }
  ]
}
```

## Runtime Execution Model

The generated bundle embeds:

- A `LiteVMRuntime` class implementing:
  - A stack array and frame pointer.
  - Opcode handlers keyed by mnemonic (see `runtime/runtime.js`).
  - Local variable storage per frame and branch dispatch via pre-resolved instruction indices.
- A `Bridge` API that lets host code plug in native functions (e.g., rendering hooks).
- A manifest mapping class + method descriptors to instruction arrays.

When a method is invoked, the runtime:

1. Creates a new frame with the requested `maxStack`/`maxLocals` sizes.
2. Iterates over the instruction list, dispatching to opcode handlers.
3. Applies branch offsets by manipulating the instruction pointer.
4. Returns results to the caller or pushes them onto the parent frame stack.

The runtime is intentionally tiny (~8 KB unminified) and designed for future optimization passes such as peephole folding or partial evaluation.

## Extensibility

- **Opcodes** – Extend the switch in `runtime/runtime.js` with new handlers. Each handler receives the runtime instance, current frame, and decoded arguments.
- **Bridges** – Register new host functions by calling `runtime.registerBridge('java/lang/System', 'out/println', fn)`.
- **Backends** – The emitter can target other outputs (e.g., WebAssembly) by swapping the implementation in `src/stage-emit.js`.
