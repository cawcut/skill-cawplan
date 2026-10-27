// Standalone crash-simulation script for the atomic write tool.
// A child process writes a large payload through atomicWriteFileSync while a
// parent kills it (SIGKILL, no cleanup chance) partway through, repeated many
// times. After every kill we check the real file: it must be either fully
// intact (old or new content) and never truncated/corrupted.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workDir = join(__dirname, ".atomic-write-crash-sim");
const targetFile = join(workDir, "data.json");
const childScript = join(__dirname, "atomic-write-crash-sim-child.mjs");

const ITERATIONS = 100;
const OLD_CONTENT = JSON.stringify({ version: "old", payload: "x".repeat(200_000) });

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

let intact = 0;
let corrupted = 0;

function isValidJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

for (let i = 0; i < ITERATIONS; i++) {
  writeFileSync(targetFile, OLD_CONTENT);

  const child = spawn("npx", ["tsx", childScript, targetFile, String(i)], {
    stdio: "ignore",
    cwd: join(__dirname, ".."),
  });

  // Kill at a random short delay so the kill lands mid-write on some fraction of runs.
  const killDelayMs = Math.floor(Math.random() * 15);
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, killDelayMs);
    child.on("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });

  if (!existsSync(targetFile)) {
    corrupted++;
    console.error(`iteration ${i}: real file missing entirely`);
    continue;
  }

  const content = readFileSync(targetFile, "utf8");
  if (isValidJson(content)) {
    intact++;
  } else {
    corrupted++;
    console.error(`iteration ${i}: real file is corrupted (invalid JSON, length=${content.length})`);
  }
}

rmSync(workDir, { recursive: true, force: true });

console.log(`模拟中断 ${ITERATIONS} 次,正式文件 ${intact} 次都完好${corrupted > 0 ? `,${corrupted} 次损坏` : ""}`);
if (corrupted > 0) {
  process.exit(1);
}
