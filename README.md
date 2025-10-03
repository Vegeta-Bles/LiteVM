# LiteVM

LiteVM is an experimental drop-in alternative to TeaVM designed for rapid build times, predictable output, and a dramatically reduced runtime surface. It translates Java bytecode from `.jar` archives into compact JavaScript bundles that run on top of a tiny stack-machine.

> ⚠️ Status: early MVP. Opcode coverage and Java standard library support are intentionally limited but the architecture is ready for incremental expansion.

## Highlights
- **Zero external dependencies** – relies only on Node.js ≥ 20 and the host JDK (`jar`, `javap`).
- **Streaming pipeline** – classes are disassembled on demand and transformed into a structured IR for emission.
- **Tiny runtime** – a ~8 KB JS stack machine executes IR with pluggable bridges for host integration and now supports basic object instantiation, primitive/reference arrays, instance/static fields, reference locals, and structured exception handling (`try`/`catch`, `ATHROW`).
- **Modular design** – extend opcode handlers and runtime bridges without touching the CLI.
- **Reflection helpers** – `runtime.listClasses()` / `runtime.getClassMetadata()` expose parsed method/field signatures for host-side tooling.

## Quick Start
```bash
# 1. Build the runtime bundle (optional – CLI builds on demand)
npm run build

# 2. Transpile a jar into a JS bundle
node src/cli.js --jar path/to/game.jar --out dist/game.bundle.js

# 3. Execute the bundle in Node (or embed in the browser)
node dist/game.bundle.js

# 4. Optional: inspect supported opcodes
npm run opcodes

# 5. Optional: compare against the full JVM opcode catalog
npm run opcodes:missing

# 6. Optional: sample opcode usage from a jar (limit classes to keep things quick) (using my Minecraft-Web directory as an    example)
npm run opcodes:usage -- --jar ../Minecraft-Web/client.jar --limit 150
```

See `docs/mvp.md` for scope details and `docs/architecture.md` for the IR + runtime design, including notes on the new object model, array heap, exception handling pipeline, and reflection metadata.

## Roadmap
- Expand opcode coverage (object creation, method invocation, arrays).
- WebAssembly backend fed from the same IR.
- Harden the default bridge layer for WebGL/WebAudio/WebSocket/File APIs (baseline stubs ship today for fast prototyping).

### Bridge Stubs

A convenience installer registers no-op Web integrations so compiled apps can boot before wiring real APIs:

```js
import { LiteVMRuntime } from './runtime/runtime.js';
import { installDefaultBridges } from './runtime/bridges/default.js';

const runtime = LiteVMRuntime.bootstrap(manifest);
installDefaultBridges(runtime, {
  logger: console.debug,
  createWebGLContext: (canvasId) => new RealWebGL(canvasId),
  createAudioContext: () => realAudioCtx,
  createWebSocket: (url) => new WebSocket(url),
  createFileBridge: () => realFileBridge,
});
```

Contributions welcome—file issues with sample jars that expose unsupported opcodes.
