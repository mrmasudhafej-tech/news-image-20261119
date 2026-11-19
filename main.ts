// The World in One Image — Thursday, 19 November 2026.
// A Node 22 program using only the standard library. It paints a
// 1024x1024 newspaper front page for the day and saves it as a PNG.
// No network is used and the output is fully deterministic:
// run it twice and the bytes are identical.
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ------------------------------------------------------------------
// The day's news — Thursday 19 November 2026, checked against live
// reporting of the day (Nikkei/AP, Al Jazeera, AFP via Korea Herald,
// Times of Israel, India Meteorological Department). Headlines are
// wrapped on word boundaries by the layout code below, so only these
// strings need to change when the news changes.
// ------------------------------------------------------------------
interface Item {
  tag: string;
  head: string;
  deck: string;
  pic: string;
}

const LEAD: Item = {
  tag: "ASIA-PACIFIC — DIPLOMACY",
  head: "TRUMP, XI AND PUTIN MEET",
  deck: "First-ever 3-way summit in Shenzhen",
  pic: "summit",
};

const GRID: Item[] = [
  {
    tag: "WORLD COURT — JUSTICE",
    head: "MYANMAR GUILTY OF GENOCIDE",
    deck: "ICJ 9-6, first state ever found guilty",
    pic: "scales",
  },
  {
    tag: "MIDDLE EAST — WAR",
    head: "HOUTHI STRIKE HITS RIYADH TOWER",
    deck: "PIF HQ skyscraper damaged in attack",
    pic: "tower",
  },
  {
    tag: "UKRAINE — WAR",
    head: "UKRAINE HITS CRIMEA BRIDGE AGAIN",
    deck: "Third strike in a week; rail halted",
    pic: "bridge",
  },
  {
    tag: "ASIA — WEATHER",
    head: "CYCLONE AKVAN WEAKENS",
    deck: "Landfall Fri on Andhra-Odisha coast",
    pic: "storm",
  },
  {
    tag: "AMERICAS — DIPLOMACY",
    head: "US AND VENEZUELA SIGN DEAL",
    deck: "Military ties restored; Hegseth in Caracas",
    pic: "flag",
  },
];

const ALSO: string[] = [
  "3 OIL TANKERS AFIRE OFF HORMUZ",
  "VAN GOGH SELLS FOR $190.4M",
  "JEFFRIES SET TO BE SPEAKER",
];

// ------------------------------------------------------------------
// Raster: a 1024x1024 RGB framebuffer plus the drawing primitives.
// ------------------------------------------------------------------
const SIDE = 1024;
type Colour = [number, number, number];
const PAPER: Colour = [247, 243, 232];
const INK: Colour = [17, 17, 17];
const RED: Colour = [176, 30, 30];
const BLUE: Colour = [29, 78, 137];
const GREY: Colour = [90, 86, 76];
const CARD: Colour = [255, 252, 244];

const img = new Uint8Array(SIDE * SIDE * 3);

function dot(x: number, y: number, c: Colour): void {
  if (x < 0 || y < 0 || x >= SIDE || y >= SIDE) return;
  const i = (y * SIDE + x) * 3;
  img[i] = c[0];
  img[i + 1] = c[1];
  img[i + 2] = c[2];
}

function box(x: number, y: number, w: number, h: number, c: Colour): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) dot(xx, yy, c);
}

function ruleH(x0: number, x1: number, y: number, c: Colour, t = 1): void {
  for (let k = 0; k < t; k++)
    for (let x = x0; x <= x1; x++) dot(x, y + k, c);
}

function ruleV(x: number, y0: number, y1: number, c: Colour, t = 1): void {
  for (let k = 0; k < t; k++)
    for (let y = y0; y <= y1; y++) dot(x + k, y, c);
}

// Bresenham segment.
function seg(x0: number, y0: number, x1: number, y1: number, c: Colour, t = 1): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    for (let a = 0; a < t; a++)
      for (let b = 0; b < t; b++) dot(x + a, y + b, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function disc(cx: number, cy: number, r: number, c: Colour): void {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) dot(x, y, c);
    }
}

function circ(cx: number, cy: number, r: number, c: Colour, t = 2): void {
  for (let y = cy - r - t; y <= cy + r + t; y++)
    for (let x = cx - r - t; x <= cx + r + t; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (Math.abs(d - r) <= t / 2) dot(x, y, c);
    }
}

// ------------------------------------------------------------------
// Letterforms: a 5x7 pixel font, one glyph per 35-bit number.
// Bits run row by row, top to bottom, left to right; bit 34 is the
// top-left pixel and bit 0 the bottom-right one.
// ------------------------------------------------------------------
const FONT: Record<string, number> = {
  A: 0x3a31fc631,
  B: 0x7a31f463e,
  C: 0x3a308422e,
  D: 0x7a318c63e,
  E: 0x7e10f421f,
  F: 0x7e10f4210,
  G: 0x3a30bc62f,
  H: 0x4631fc631,
  I: 0x38842108e,
  J: 0x1c4210a4c,
  K: 0x4654c5251,
  L: 0x42108421f,
  M: 0x4775ac631,
  N: 0x47359c631,
  O: 0x3a318c62e,
  P: 0x7a31f4210,
  Q: 0x3a318d64d,
  R: 0x7a31f5251,
  S: 0x3e107043e,
  T: 0x7c8421084,
  U: 0x46318c62e,
  V: 0x46318c544,
  W: 0x4631ad771,
  X: 0x462a22a31,
  Y: 0x462a21084,
  Z: 0x7c222221f,
  "0": 0x3a33ae62e,
  "1": 0x11842108e,
  "2": 0x3a213221f,
  "3": 0x78217043e,
  "4": 0x08ca97c42,
  "5": 0x7e1e0862e,
  "6": 0x3a10f462e,
  "7": 0x7c2222108,
  "8": 0x3a317462e,
  "9": 0x3a317842e,
  ".": 0x00000018c,
  ",": 0x000003088,
  ":": 0x018c03180,
  ";": 0x018c03088,
  "'": 0x108800000,
  "-": 0x000070000,
  "/": 0x044222110,
  "&": 0x32544564d,
  "%": 0x674222173,
  "(": 0x088842082,
  ")": 0x208210888,
  "!": 0x108421004,
  "?": 0x3a2131004,
  $: 0x11f4717c4,
  " ": 0x000000000,
};

function glyphOf(ch: string): number {
  if (ch === "\u2014" || ch === "\u2013") return FONT["-"];
  const up = ch.toUpperCase();
  return FONT[up] !== undefined ? FONT[up] : FONT[" "];
}

function drawGlyph(x: number, y: number, ch: string, s: number, c: Colour): void {
  const bits = glyphOf(ch);
  for (let r = 0; r < 7; r++)
    for (let col = 0; col < 5; col++) {
      const bit = 34 - (r * 5 + col);
      if ((bits >> bit) & 1) box(x + col * s, y + r * s, s, s, c);
    }
}

function measure(text: string, s: number): number {
  const n = [...text].length;
  return n === 0 ? 0 : n * 6 * s - s;
}

function drawStr(x: number, y: number, text: string, s: number, c: Colour): void {
  let cx = x;
  for (const ch of text) {
    drawGlyph(cx, y, ch, s, c);
    cx += 6 * s;
  }
}

function drawStrC(cx: number, y: number, text: string, s: number, c: Colour): void {
  drawStr(cx - Math.floor(measure(text, s) / 2), y, text, s, c);
}

// Split text into lines of at most maxChars characters, on word breaks.
function splitLines(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// Draw uppercased wrapped text; returns the lines drawn.
function drawBlock(
  x: number,
  y: number,
  text: string,
  s: number,
  maxChars: number,
  c: Colour,
  gap = 4,
): string[] {
  const lines = splitLines(text.toUpperCase(), maxChars);
  let yy = y;
  for (const ln of lines) {
    drawStr(x, yy, ln, s, c);
    yy += 7 * s + gap;
  }
  return lines;
}

// ------------------------------------------------------------------
// Pictograms — small geometric drawings, one per story.
// ------------------------------------------------------------------
function pic(kind: string, cx: number, cy: number, c: Colour, accent: Colour): void {
  if (kind === "summit") {
    // Three leaders seated at a table, two small flags behind them.
    disc(cx - 26, cy - 16, 9, c);
    disc(cx, cy - 22, 9, accent);
    disc(cx + 26, cy - 16, 9, c);
    box(cx - 38, cy - 4, 76, 8, c);
    box(cx - 38, cy + 4, 8, 18, c);
    box(cx + 30, cy + 4, 8, 18, c);
    seg(cx - 26, cy - 26, cx - 30, cy - 38, BLUE, 2);
    seg(cx + 26, cy - 26, cx + 30, cy - 38, BLUE, 2);
    box(cx - 38, cy - 38, 12, 8, RED);
    box(cx + 26, cy - 38, 12, 8, BLUE);
    disc(cx, cy + 28, 4, GREY);
  } else if (kind === "scales") {
    // Scales of justice: pillar, beam and two pans.
    ruleV(cx, cy - 30, cy + 30, c, 4);
    ruleH(cx - 28, cx + 28, cy - 28, c, 3);
    disc(cx, cy - 32, 5, accent);
    seg(cx - 28, cy - 28, cx - 34, cy - 6, c, 2);
    seg(cx - 28, cy - 28, cx - 22, cy - 6, c, 2);
    seg(cx + 28, cy - 28, cx + 22, cy - 6, c, 2);
    seg(cx + 28, cy - 28, cx + 34, cy - 6, c, 2);
    box(cx - 38, cy - 6, 16, 4, c);
    box(cx + 22, cy - 6, 16, 4, c);
    box(cx - 16, cy + 28, 32, 5, c);
  } else if (kind === "tower") {
    // A skyscraper struck from above: lit windows, a crack, smoke.
    box(cx - 14, cy - 34, 28, 68, c);
    for (let r = 0; r < 5; r++)
      for (let col = 0; col < 2; col++)
        box(cx - 9 + col * 11, cy - 28 + r * 12, 6, 6, CARD);
    seg(cx + 6, cy - 34, cx - 2, cy - 10, accent, 3);
    seg(cx - 2, cy - 10, cx + 8, cy + 6, accent, 3);
    disc(cx - 20, cy - 38, 6, GREY);
    disc(cx - 28, cy - 30, 4, GREY);
    disc(cx - 12, cy - 42, 4, GREY);
    box(cx - 20, cy + 34, 40, 4, c);
  } else if (kind === "bridge") {
    // A bridge over water, with a blast burst above the deck.
    ruleH(cx - 36, cx + 36, cy - 6, c, 4);
    ruleV(cx - 24, cy - 26, cy + 10, c, 4);
    ruleV(cx + 24, cy - 26, cy + 10, c, 4);
    for (let a = 0; a <= 180; a += 15) {
      const t = (a * Math.PI) / 180;
      const x = Math.round(cx - 24 + 48 * (a / 180));
      const y = Math.round(cy - 6 + 14 * Math.sin(t));
      disc(x, y, 2, c);
    }
    ruleH(cx - 36, cx + 36, cy + 14, BLUE, 3);
    ruleH(cx - 30, cx + 30, cy + 24, BLUE, 2);
    disc(cx, cy - 32, 5, accent);
    seg(cx, cy - 32, cx - 10, cy - 40, accent, 2);
    seg(cx, cy - 32, cx + 10, cy - 40, accent, 2);
    seg(cx, cy - 32, cx, cy - 42, accent, 2);
  } else if (kind === "storm") {
    // A cyclone: three stacked cloud rings and rain slashes.
    circ(cx, cy - 8, 26, c, 3);
    circ(cx - 12, cy - 2, 16, c, 3);
    circ(cx + 12, cy - 2, 16, c, 3);
    disc(cx, cy - 8, 8, accent);
    seg(cx - 28, cy + 22, cx - 32, cy + 34, BLUE, 3);
    seg(cx - 8, cy + 22, cx - 12, cy + 34, BLUE, 3);
    seg(cx + 12, cy + 22, cx + 8, cy + 34, BLUE, 3);
    seg(cx + 30, cy + 22, cx + 26, cy + 34, BLUE, 3);
  } else {
    // A flag on a pole, waving.
    ruleV(cx - 20, cy - 32, cy + 30, c, 4);
    disc(cx - 20, cy - 34, 4, accent);
    seg(cx - 20, cy - 32, cx + 22, cy - 24, RED, 2);
    seg(cx - 20, cy - 22, cx + 22, cy - 14, RED, 2);
    box(cx - 20, cy - 32, 42, 18, RED);
    box(cx - 20, cy - 32, 14, 18, BLUE);
    box(cx - 26, cy + 30, 12, 4, c);
  }
}

// ------------------------------------------------------------------
// PNG output — chunks and CRC32, built on the standard zlib deflate.
// ------------------------------------------------------------------
const CRC: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    table.push(v >>> 0);
  }
  return table;
})();

function crcOf(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(kind: string, payload: Buffer): Buffer {
  const head = Buffer.from(kind, "ascii");
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  head.copy(out, 4);
  payload.copy(out, 8);
  out.writeUInt32BE(crcOf(Buffer.concat([head, payload])), 8 + payload.length);
  return out;
}

function renderPNG(): Buffer {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(SIDE, 0);
  head.writeUInt32BE(SIDE, 4);
  head[8] = 8; // 8-bit samples
  head[9] = 2; // colour type 2: truecolour RGB
  // Scanlines, each prefixed by filter byte 0.
  const stride = 1 + SIDE * 3;
  const raw = Buffer.alloc(SIDE * stride);
  for (let y = 0; y < SIDE; y++) {
    raw[y * stride] = 0;
    raw.set(img.subarray(y * SIDE * 3, (y + 1) * SIDE * 3), y * stride + 1);
  }
  const body = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    magic,
    pngChunk("IHDR", head),
    pngChunk("IDAT", body),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------
// Page composition — a newspaper front page, 1024x1024.
// ------------------------------------------------------------------
function paint(): void {
  box(0, 0, SIDE, SIDE, PAPER);
  box(0, 0, SIDE, 10, INK);
  box(0, SIDE - 10, SIDE, 10, INK);
  box(0, 0, 10, SIDE, INK);
  box(SIDE - 10, 0, 10, SIDE, INK);
  const M = 28;
  ruleH(M, SIDE - M, 22, INK, 2);
  ruleH(M, SIDE - M, SIDE - 24, INK, 2);

  // Masthead.
  drawStrC(SIDE / 2, 40, "THE WORLD IN ONE IMAGE", 5, INK);
  ruleH(120, SIDE - 120, 92, RED, 4);
  drawStrC(SIDE / 2, 108, "THURSDAY, 19 NOVEMBER 2026", 6, RED);
  drawStrC(SIDE / 2, 162, "SIX STORIES FROM AROUND THE WORLD", 2, GREY);
  ruleH(M, SIDE - M, 192, INK, 4);

  // Lead story, full width, y 208..438, picture panel on the right.
  drawStr(40, 214, LEAD.tag, 2, RED);
  const headLines = drawBlock(40, 240, LEAD.head, 4, 24, INK, 6);
  const deckY = 240 + headLines.length * (7 * 4 + 6) + 4;
  drawBlock(40, deckY, LEAD.deck, 3, 31, BLUE, 5);
  box(660, 208, 328, 214, CARD);
  ruleH(660, 988, 208, INK, 2);
  ruleH(660, 988, 422, INK, 2);
  ruleV(660, 208, 422, INK, 2);
  ruleV(988, 208, 422, INK, 2);
  pic("summit", 824, 300, INK, RED);
  drawStrC(824, 368, "90 MINUTES, NO DEAL", 2, GREY);
  drawStrC(824, 388, "NUCLEAR TALKS AGREED", 2, GREY);
  ruleH(M, SIDE - M, 438, INK, 3);

  // Grid: 3 columns x 2 rows, y 456..952 — five stories plus ALSO TODAY.
  const top = 456;
  const cw = 312;
  const gap = 16;
  const rh = 238;
  const rgap = 20;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const x = M + c * (cw + gap);
      const y = top + r * (rh + rgap);
      box(x, y, cw, rh, CARD);
      ruleH(x, x + cw - 1, y, INK, 2);
      ruleH(x, x + cw - 1, y + rh - 1, INK, 2);
      ruleV(x, y, y + rh - 1, INK, 2);
      ruleV(x + cw - 1, y, y + rh - 1, INK, 2);
      if (idx < GRID.length) {
        const s = GRID[idx];
        pic(s.pic, x + 52, y + 52, INK, RED);
        drawBlock(x + 104, y + 16, s.tag, 2, 15, RED, 3);
        const hy = y + 108;
        const hl = drawBlock(x + 16, hy, s.head, 3, 15, INK, 4);
        const sy = hy + hl.length * (7 * 3 + 4) + 6;
        drawBlock(x + 16, sy, s.deck, 2, 23, BLUE, 3);
      } else {
        drawStr(x + 16, y + 16, "ALSO TODAY", 3, RED);
        ruleH(x + 16, x + cw - 17, y + 46, RED, 3);
        let yy = y + 62;
        for (const item of ALSO) {
          drawStr(x + 16, yy, "*", 2, RED);
          const lines = drawBlock(x + 34, yy, item, 2, 21, INK, 3);
          yy += lines.length * (7 * 2 + 3) + 10;
        }
      }
    }
  }

  // Footer.
  drawStrC(SIDE / 2, 972, "SOURCES: REUTERS, AP, BBC, AFP", 2, GREY);
}

// ------------------------------------------------------------------
function main(): void {
  paint();
  const png = renderPNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), png);
}

main();
