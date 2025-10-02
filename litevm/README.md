# LiteVM

LiteVM is an experimental drop-in alternative to TeaVM designed for rapid build times, predictable output, and a dramatically reduced runtime surface. It translates Java bytecode from `.jar` archives into compact JavaScript bundles that run on top of a tiny stack-machine.

> ⚠️ Status: early MVP. Opcode coverage and Java standard library support are intentionally limited but the architecture is ready for incremental expansion.

## Highlights
- **Zero external dependencies** – relies only on Node.js ≥ 20 and the host JDK (`jar`, `javap`).
- **Streaming pipeline** – classes are disassembled on demand and transformed into a structured IR for emission.
- **Tiny runtime** – a ~8 KB JS stack machine executes IR with pluggable bridges for host integration and now supports basic object instantiation, instance/static fields, and reference locals.
- **Modular design** – extend opcode handlers and runtime bridges without touching the CLI.

## Quick Start
```bash
# 1. Build the runtime bundle (optional – CLI builds on demand)
npm run build

# 2. Transpile a jar into a JS bundle
node src/cli.js --jar path/to/game.jar --out dist/game.bundle.js

# 3. Execute the bundle in Node (or embed in the browser)
node dist/game.bundle.js
```

See `docs/mvp.md` for scope details and `docs/architecture.md` for the IR + runtime design, including notes on the new object model and field handling.

## Roadmap
- Expand opcode coverage (object creation, method invocation, arrays).
- WebAssembly backend fed from the same IR.
- Deterministic bridge layer for graphics/audio APIs (WebGL, WebAudio).

Contributions welcome—file issues with sample jars that expose unsupported opcodes.
