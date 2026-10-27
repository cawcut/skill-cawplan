import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Attempts, in order, to render an SVG inline in the current terminal using
 * whichever tool is actually available -- no single terminal-graphics
 * protocol is universal (iTerm2's proprietary escape codes, Kitty's graphics
 * protocol, and Sixel are mutually incompatible), so this tries each
 * candidate rather than betting on one.
 *
 * Deliberately shells out to already-installed tools instead of bundling an
 * SVG rasterizer into this CLI: every one of these protocols needs a raster
 * image, not SVG source, and adding our own rasterizer (native or WASM) would
 * reintroduce exactly the native-dependency weight the SVG chart renderer
 * was chosen to avoid in the first place.
 *
 * Returns true if a renderer both exists and reported success -- callers
 * should fall back to something else (e.g. --chart/--png) when this returns
 * false, since that means nothing capable of showing this inline was found.
 */
export function tryRenderSvgInTerminal(svg: string): boolean {
  const tmpPath = join(tmpdir(), `cawplan-chart-${randomUUID()}.svg`);
  writeFileSync(tmpPath, svg, "utf-8");
  try {
    return RENDERERS.some((render) => render(tmpPath));
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup; a leftover temp file in $TMPDIR is harmless.
    }
  }
}

type Renderer = (path: string) => boolean;

// Order matters: cheapest/most-specific-to-detect first. chafa auto-detects
// the terminal's actual graphics capability, so it's a reasonable universal
// fallback once we already know we're not obviously in iTerm2 or Kitty.
const RENDERERS: Renderer[] = [renderWithITermImgcat, renderWithKittyIcat, renderWithChafa];

/**
 * iTerm2 ships `imgcat` in its app bundle, which is not always on $PATH even
 * though the shell integration usually puts it there -- fall back to the
 * bundle path directly. Verified against a real chart file: iTerm2 decodes
 * SVG bytes handed through its inline-image protocol without needing a
 * separate rasterization step first.
 */
function renderWithITermImgcat(path: string): boolean {
  if (process.env.TERM_PROGRAM !== "iTerm.app") return false;
  return (
    runQuiet("imgcat", [path]) ||
    runQuiet("/Applications/iTerm.app/Contents/Resources/utilities/imgcat", [path])
  );
}

/**
 * Kitty's graphics protocol via its bundled `icat` kitten. Not independently
 * verified against a live Kitty terminal in this environment -- if `kitten`/
 * `kitty` genuinely can't rasterize SVG on some platform, this renderer
 * simply reports failure (non-zero exit) and the chain moves on, same as any
 * other unavailable tool.
 */
function renderWithKittyIcat(path: string): boolean {
  const inKitty = process.env.TERM === "xterm-kitty" || Boolean(process.env.KITTY_WINDOW_ID);
  if (!inKitty) return false;
  return runQuiet("kitten", ["icat", path]) || runQuiet("kitty", ["+kitten", "icat", path]);
}

/** chafa auto-detects Sixel/Kitty/iTerm2 support or falls back to ANSI block
 * art; it's the closest thing to a universal terminal-image tool, so it's
 * tried regardless of $TERM_PROGRAM/$TERM once the two specific tools above
 * have already had their shot. */
function renderWithChafa(path: string): boolean {
  return runQuiet("chafa", [path]);
}

/**
 * Runs cmd with stdout inherited (so the raw terminal-graphics escape
 * sequences reach the actual terminal, not this process's captured output)
 * and stderr/stdin discarded. Returns false uniformly whether the binary is
 * missing (spawnSync sets `.error` with ENOENT) or it ran and failed --
 * callers only need "did this work", not why it didn't.
 */
function runQuiet(cmd: string, args: string[]): boolean {
  const result = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "ignore"] });
  return !result.error && result.status === 0;
}
