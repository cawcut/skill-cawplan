import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { displayImageSize, parseImageSize, readImageSize } from "../src/lib/image-dimensions.js";

function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gifHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(13);
  buf.write("GIF89a", 0, "ascii");
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function bmpHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(54);
  buf.write("BM", 0, "ascii");
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  return buf;
}

function webp(chunk: string, data: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(12 + data.length, 4);
  head.write("WEBP", 8, "ascii");
  head.write(chunk, 12, "ascii");
  head.writeUInt32LE(data.length, 16);
  return Buffer.concat([head, data]);
}

function exifApp1(orientation: number, littleEndian: boolean): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write(littleEndian ? "II" : "MM", 0, "ascii");
  const u16 = (v: number, at: number) => (littleEndian ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const u32 = (v: number, at: number) => (littleEndian ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  u16(42, 2);
  u32(8, 4);
  u16(1, 8); // one IFD0 entry
  u16(0x0112, 10);
  u16(3, 12); // SHORT
  u32(1, 14);
  u16(orientation, 18);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([seg, payload]);
}

function jpeg(width: number, height: number, segments: Buffer[] = [], sof = 0xc0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const frame = Buffer.alloc(19);
  frame.writeUInt16BE(0xff00 | sof, 0);
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, ...segments, frame, Buffer.from([0xff, 0xd9])]);
}

describe("parseImageSize", () => {
  test("reads PNG, GIF and BMP headers", () => {
    expect(parseImageSize(pngHeader(2880, 1800))).toEqual({ width: 2880, height: 1800 });
    expect(parseImageSize(gifHeader(320, 240))).toEqual({ width: 320, height: 240 });
    // Top-down bitmaps store a negative height.
    expect(parseImageSize(bmpHeader(640, -480))).toEqual({ width: 640, height: 480 });
  });

  test("reads lossy, lossless and extended WebP", () => {
    const vp8 = Buffer.alloc(10);
    vp8.set([0x9d, 0x01, 0x2a], 3);
    vp8.writeUInt16LE(1024, 6);
    vp8.writeUInt16LE(768, 8);
    expect(parseImageSize(webp("VP8 ", vp8))).toEqual({ width: 1024, height: 768 });

    const vp8l = Buffer.alloc(10);
    vp8l[0] = 0x2f;
    vp8l.writeUInt32LE((1999 & 0x3fff) | ((999 & 0x3fff) << 14), 1);
    expect(parseImageSize(webp("VP8L", vp8l))).toEqual({ width: 2000, height: 1000 });

    const vp8x = Buffer.alloc(10);
    vp8x.writeUIntLE(4095, 4, 3);
    vp8x.writeUIntLE(2047, 7, 3);
    expect(parseImageSize(webp("VP8X", vp8x))).toEqual({ width: 4096, height: 2048 });
  });

  test("reads the JPEG frame size, including progressive frames", () => {
    expect(parseImageSize(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(parseImageSize(jpeg(1920, 1080, [], 0xc2))).toEqual({ width: 1920, height: 1080 });
  });

  test("swaps JPEG width and height for EXIF quarter-turn orientations", () => {
    expect(parseImageSize(jpeg(4032, 3024, [exifApp1(6, true)]))).toEqual({ width: 3024, height: 4032 });
    expect(parseImageSize(jpeg(4032, 3024, [exifApp1(8, false)]))).toEqual({ width: 3024, height: 4032 });
    expect(parseImageSize(jpeg(4032, 3024, [exifApp1(3, true)]))).toEqual({ width: 4032, height: 3024 });
  });

  test("returns undefined for unknown, truncated or zero-sized images", () => {
    expect(parseImageSize(Buffer.from("12345"))).toBeUndefined();
    expect(parseImageSize(pngHeader(100, 100).subarray(0, 20))).toBeUndefined();
    expect(parseImageSize(jpeg(100, 100).subarray(0, 25))).toBeUndefined();
    expect(parseImageSize(pngHeader(0, 100))).toBeUndefined();
  });
});

describe("displayImageSize", () => {
  test("keeps images up to 360px wide and scales wider ones down to 360px", () => {
    expect(displayImageSize({ width: 200, height: 120 })).toEqual({ width: 200, height: 120 });
    expect(displayImageSize({ width: 360, height: 1000 })).toEqual({ width: 360, height: 1000 });
    expect(displayImageSize({ width: 600, height: 400 })).toEqual({ width: 360, height: 240 });
    expect(displayImageSize({ width: 1280, height: 1707 })).toEqual({ width: 360, height: 480 });
    expect(displayImageSize({ width: 2880, height: 1800 })).toEqual({ width: 360, height: 225 });
    expect(displayImageSize({ width: 10000, height: 1 })).toEqual({ width: 360, height: 1 });
  });
});

describe("readImageSize", () => {
  test("reads a file header and tolerates missing files", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cawplan-imgsize-"));
    try {
      writeFileSync(path.join(dir, "a.png"), pngHeader(1600, 900));
      expect(await readImageSize(path.join(dir, "a.png"))).toEqual({ width: 1600, height: 900 });
      expect(await readImageSize(path.join(dir, "nope.png"))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
