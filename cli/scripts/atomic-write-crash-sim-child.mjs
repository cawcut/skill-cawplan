// Child process for atomic-write-crash-sim.mjs: writes a large new payload
// through the real atomicWriteFileSync and may be SIGKILLed by the parent at
// any point during this write.
import { atomicWriteFileSync } from "../src/lib/testpoint-review/atomic-write.ts";

const [, , targetFile, iteration] = process.argv;

const newContent = JSON.stringify({ version: "new", iteration, payload: "y".repeat(5_000_000) });

atomicWriteFileSync(targetFile, newContent);
