import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Rasterizes SVG to a PNG file, for contexts that can display an image but
 * not SVG source -- notably: reading the result back with a tool that
 * decodes raster formats (PNG/JPEG/etc.) but treats SVG as plain XML text,
 * which is exactly the gap between "--chart writes an SVG" and "a Claude
 * Code skill wants to show the chart inline in a chat response."
 *
 * Shells out to whichever rasterizer is actually available, in the same
 * spirit as terminal-image.ts: adding a bundled SVG rasterizer (native or
 * WASM) to this CLI would reintroduce the native-dependency weight choosing
 * SVG over a canvas-based PNG renderer was meant to avoid. `qlmanage` (macOS,
 * part of the OS, no install needed) is tried first since it's the only
 * option verified to work in this environment; `rsvg-convert` (commonly
 * available on Linux via librsvg) is the cross-platform fallback.
 *
 * Returns true and leaves a PNG at outPath on success. Returns false (and
 * leaves nothing at outPath) when no rasterizer was found or the one that
 * ran failed -- callers should treat this as "PNG export isn't possible in
 * this environment," not retry differently.
 */
export function rasterizeSvgToPng(svg: string, outPath: string): boolean {
  const tmpDir = tmpdir();
  const tmpSvgPath = join(tmpDir, `cawplan-chart-${randomUUID()}.svg`);
  writeFileSync(tmpSvgPath, svg, "utf-8");

  try {
    return RASTERIZERS.some((rasterize) => rasterize(tmpSvgPath, outPath));
  } finally {
    try {
      unlinkSync(tmpSvgPath);
    } catch {
      // Best-effort cleanup.
    }
  }
}

type Rasterizer = (svgPath: string, outPath: string) => boolean;

const RASTERIZERS: Rasterizer[] = [rasterizeWithQlmanage, rasterizeWithRsvgConvert];

/**
 * macOS's Quick Look thumbnail generator. Verified against a real chart: it
 * renders SVG faithfully (colors, paths, text all correct), but `-t` always
 * produces a square N x N canvas regardless of the source's aspect ratio --
 * a wide/short chart like this one's default 960x480 comes back letterboxed
 * with blank space below rather than cropped to content. That's a cosmetic
 * limitation of this tool, not a rendering-correctness problem, and not
 * worth adding image-processing code (crop/trim) to fix -- it would mean
 * pulling in exactly the kind of raster-manipulation dependency this
 * approach exists to avoid.
 */
function rasterizeWithQlmanage(svgPath: string, outPath: string): boolean {
  if (process.platform !== "darwin") return false;

  const tmpDir = tmpdir();
  const result = spawnSync("qlmanage", ["-t", "-s", "960", "-o", tmpDir, svgPath], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (result.error || result.status !== 0) return false;

  // qlmanage names its output "<basename>.png" in the given directory --
  // not configurable, so it has to be moved to the caller's requested path.
  const producedPath = join(tmpDir, `${svgPath.split("/").pop()}.png`);
  if (!existsSync(producedPath)) return false;

  try {
    renameSync(producedPath, outPath);
    return true;
  } catch {
    return false;
  }
}

/** Cross-platform fallback, common on Linux via the librsvg package. Not
 * independently verified in this environment (only macOS was available to
 * test against) -- if it's genuinely broken on some platform, it simply
 * reports failure like any other missing tool, and the chain moves on. */
function rasterizeWithRsvgConvert(svgPath: string, outPath: string): boolean {
  const result = spawnSync("rsvg-convert", ["-o", outPath, svgPath], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return !result.error && result.status === 0;
}
