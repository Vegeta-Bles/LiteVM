# Opcode Expansion Roadmap

## Current Snapshot
- Supported opcodes discovered in dispatcher: **65**
- Missing opcodes vs. JVM catalog: **81** (`npm run opcodes:missing`)
- Sampled Minecraft client jar (first 200 classes): `npm run opcodes:usage -- --jar samples/client.jar --limit 200`
  - Total distinct opcodes seen: **101**
  - High-frequency missing opcodes:
    - `INVOKEINTERFACE` (572 occurrences)
    - `INVOKEDYNAMIC` (397)
    - `CHECKCAST` (246)
    - `INSTANCEOF` (3, but critical for type checks)
    - Float/double stack ops (`FCONST`, `FLOAD`, `FSTORE`, `FMUL`, `FADD`, `FSUB`, `FDIV`, `FRETURN`, `D*`, etc.)
    - Null branches (`IFNULL`, `IFNONNULL`)
    - Switch tables (`TABLESWITCH`, `LOOKUPSWITCH`)
    - Long/float/double conversions (`I2F`, `I2D`, `L2F`, `D2F`, `F2D`, `LDC2`, etc.)

## Grouped Work Packages

### 1. Invocation & Type Mechanics
- Opcodes: `INVOKEINTERFACE`, `INVOKEDYNAMIC`, `INVOKESPECIAL` (full class resolution), `CHECKCAST`, `INSTANCEOF`
- Dependencies: 
  - Class metadata lookup (`interfaces`, `method_handle` resolution)
  - Bootstrap method support for `invokedynamic`
  - Runtime type hierarchy queries (already partially in place)
- Recommended output: extend `LiteVMRuntime` resolution logic, add bootstrap table ingestion, expand constant-pool parsing.

### 2. Floating Point & Double/Long Stack Semantics
- Opcodes: all `F*` and `D*` loads/stores/consts/arithmetic, plus `LCONST`, `L*` arithmetic and conversions
- Dependencies: 64-bit value representation (JS Numbers vs. BigInts), NaN/Infinity semantics, conversion helpers, additional slots for wide values.
- Recommended output: widen frame stack to hold tagged values, implement numeric helpers mirroring JVM spec.

### 3. Branching & Switches
- Opcodes: `IFNULL`, `IFNONNULL`, `IF_ACMP*`, `TABLESWITCH`, `LOOKUPSWITCH`
- Dependencies: existing branch machinery already resolves targets; need additional handlers plus table decoding in IR normalization.
- Recommended output: parser/IR support for switch payloads, runtime dispatch for multi-way branches.

### 4. Array & Object Utilities
- Opcodes: `MULTIANEWARRAY`, `MONITORENTER`, `MONITOREXIT`
- Dependencies: multi-dimensional array allocator, monitor model (even if single-threaded, need stub semantics to keep bytecode happy).
- Recommended output: extend allocator to nested structures, track synthetic monitor tokens.

### 5. Conversions & Bitwise Ops
- Opcodes: remaining `I2*`, `L2*`, `F2*`, `D2*`, `LSHL`, `LSHR`, `LUSHR`, etc.
- Dependencies: numeric helpers from Group 2.
- Recommended output: implement conversion helpers and bit ops once long/double support lands.

## Suggested Sequence
1. **Numeric Foundation (Group 2 + 5)** – unlocks large surface area (math, comparisons, conversions) used heavily by Minecraft.
2. **Invocation & Type Mechanics (Group 1)** – necessary for interface calls, invokedynamic bootstrap, and runtime type checks.
3. **Branching & Switches (Group 3)** – ensures control flow structures operate correctly.
4. **Array/Object Utilities (Group 4)** – fills gaps for multi-dimensional arrays and monitor ops.
5. Iterate with additional usage scans to validate coverage against new jars.

## Tooling Checklist
- `npm run opcodes` – list opcodes currently implemented in the runtime dispatcher.
- `npm run opcodes:missing` – diff against the JVM opcode catalog to surface gaps.
- `npm run opcodes:usage -- --jar <path> --limit <n>` – analyze real jars to prioritize implementation by occurrence.

Keep iterating on the usage command after each milestone to confirm impact and adjust priorities.
