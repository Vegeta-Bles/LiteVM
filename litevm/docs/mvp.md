# LiteVM MVP Scope

## Objective
Deliver a lightweight Java bytecode to browser runtime toolchain that can load `.jar` archives and emit compact JavaScript bundles with a thin execution runtime. The tool should be opinionated toward speed of build, predictable output, and ease of embedding.

## MVP Capabilities
- Accept a `.jar` file input through a CLI entry point.
- Discover classes using the host JDK tooling (`jar`, `javap`) without external dependencies.
- Convert `javap` disassembly into a structured intermediate representation (IR).
- Emit a browser-friendly JavaScript bundle containing:
  - Bytecode IR data for each translated method.
  - A minimal stack machine runtime to execute the IR.
  - A small stdlib shim for basic Java types (currently `java/lang/Object`, primitive wrappers, and primitive/reference arrays).
- Provide hooks for plugging in host functions (e.g., rendering, input) via a bridge API.
- Include a smoke test that exercises the pipeline on a toy `.jar` with arithmetic and branching.

## Non-goals (for now)
- Full Java standard library parity.
- Native method support beyond explicitly mapped bridge functions.
- Advanced optimizations (JIT/AOT, aggressive dead-code elimination).
- Multithreading or concurrency features.
- Direct WebAssembly emission.

## Success Criteria
- End-to-end CLI run produces a runnable JS bundle under 150 KB for the sample jar.
- Runtime startup under 200 ms in Node for the sample jar (measured via script).
- Documentation sufficient for another engineer to extend opcode coverage and host bridges.

## Incremental Plan
- **Phase 1 (✅)** – Object instantiation, static/instance fields, and primitive/reference array opcodes.
- **Phase 2 (✅)** – Exception tables, `ATHROW`, runtime-generated exceptions (division/modulo by zero), and try/catch dispatch in the interpreter.
- **Phase 3 (🚧)** – Reflection metadata plus hardened bridge surfaces for WebGL/WebAudio/WebSocket/File APIs (baseline stubs ship in `runtime/bridges/default.js`).
