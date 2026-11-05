import { open } from "node:fs/promises";

/**
 * Pixel size of a local image, read from its header without decoding it.
 *
 * Uploaded images are embedded with explicit width/height (CWP-26400): the web
 * editor's resizable image wrapper has no max-width, so an <img> without them
 * renders at its natural size and large screenshots overflow the ticket.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Widest an uploaded image is shown by default: about half of the ticket
 * content column (~700px). The CLI cannot measure the editor, and the editor
 * only honours pixel sizes, so this is a fixed width. Users can still resize.
 */
export const MAX_IMAGE_DISPLAY_WIDTH = 360;

/** Enough to get past EXIF thumbnails and ICC profiles to a JPEG's SOF marker. */
const HEADER_BYTES = 512 * 1024;

/** Natural size of a PNG, GIF, JPEG, WebP or BMP file; undefined when unknown or unreadable. */
export async function readImageSize(filePath: string): Promise<ImageSize | undefined> {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    return parseImageSize(buf.subarray(0, bytesRead));
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** Natural size from the leading bytes of an image file. */
export function parseImageSize(buf: Buffer): ImageSize | undefined {
  try {
    const size = parsePng(buf) ?? parseGif(buf) ?? parseJpeg(buf) ?? parseWebp(buf) ?? parseBmp(buf);
    return size && size.width > 0 && size.height > 0 ? size : undefined;
  } catch {
    // Truncated header: reads past the buffer throw RangeError.
    return undefined;
  }
}

/** Size to embed: the natural size, scaled down to MAX_IMAGE_DISPLAY_WIDTH keeping the aspect ratio. */
export function displayImageSize(natural: ImageSize): ImageSize {
  if (natural.width <= MAX_IMAGE_DISPLAY_WIDTH) return natural;
  const scale = MAX_IMAGE_DISPLAY_WIDTH / natural.width;
  return { width: MAX_IMAGE_DISPLAY_WIDTH, height: Math.max(1, Math.round(natural.height * scale)) };
}

function parsePng(buf: Buffer): ImageSize | undefined {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function parseGif(buf: Buffer): ImageSize | undefined {
  if (buf.length < 10 || buf.toString("ascii", 0, 4) !== "GIF8") return undefined;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function parseBmp(buf: Buffer): ImageSize | undefined {
  if (buf.length < 26 || buf.toString("ascii", 0, 2) !== "BM") return undefined;
  // Negative height marks a top-down bitmap.
  return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
}

function parseWebp(buf: Buffer): ImageSize | undefined {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return undefined;
  switch (buf.toString("ascii", 12, 16)) {
    case "VP8 ":
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    case "VP8L": {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case "VP8X":
      return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    default:
      return undefined;
  }
}

/** SOFn markers that carry the frame size (C4 DHT, C8 JPG and CC DAC are not frames). */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parseJpeg(buf: Buffer): ImageSize | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let orientation = 1;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2; // standalone marker, no length
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (JPEG_SOF.has(marker)) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      // Browsers apply EXIF orientation; 5–8 rotate the image a quarter turn.
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
    }
    if (marker === 0xe1) orientation = exifOrientation(buf, i + 4, i + 2 + length) ?? orientation;
    i += 2 + length;
  }
  return undefined;
}

/** EXIF Orientation (tag 0x0112) from an APP1 payload starting at `start`. */
function exifOrientation(buf: Buffer, start: number, end: number): number | undefined {
  if (end > buf.length || buf.toString("ascii", start, start + 6) !== "Exif\0\0") return undefined;
  const tiff = start + 6;
  const order = buf.toString("ascii", tiff, tiff + 2);
  if (order !== "II" && order !== "MM") return undefined;
  const le = order === "II";
  const u16 = (at: number) => (le ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at: number) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return undefined;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) return undefined;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return undefined;
}
