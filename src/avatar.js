// ─────────────────────────────────────────────────────────────
// avatar — the baked luminance map, cropped to the terminal's
// real cell shape, toned, tinted with the theme's phosphor ramp,
// then emitted either as half-block (▀) art or as a PNG for
// terminals that speak an inline-image protocol
// ─────────────────────────────────────────────────────────────

import { inflateSync } from "node:zlib";
import { SIZE, DATA } from "./avatar-data.js";
import { mix } from "./paint.js";
import { encodePNG } from "./png.js";

// source pixels in linear light, so downscaling averages photons, not gamma
let SRC = null;
function source() {
  if (!SRC) {
    const bytes = inflateSync(Buffer.from(DATA, "base64"));
    SRC = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) SRC[i] = (bytes[i] / 255) ** 2.2;
  }
  return SRC;
}

// centered crop of the square source with the given width/height ratio
function cropFor(aspect) {
  return aspect >= 1
    ? { x: 0, y: (SIZE - SIZE / aspect) / 2, w: SIZE, h: SIZE / aspect }
    : { x: (SIZE - SIZE * aspect) / 2, y: 0, w: SIZE * aspect, h: SIZE };
}

function lanczos3(x) {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

// per-output-pixel filter taps; the kernel widens when shrinking (anti-aliasing)
function taps(offset, span, dstN) {
  const scale = span / dstN;
  const fs = Math.max(1, scale);
  const support = 3 * fs;
  const out = [];
  for (let i = 0; i < dstN; i++) {
    const center = offset + (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(center - support));
    const hi = Math.min(SIZE, Math.ceil(center + support));
    const ws = [];
    let sum = 0;
    for (let j = lo; j < hi; j++) {
      const w = lanczos3((j + 0.5 - center) / fs);
      ws.push(w);
      sum += w;
    }
    out.push({ lo, ws: ws.map((w) => w / sum) });
  }
  return out;
}

// highlights rolled off so the bright backdrop doesn't swallow the face,
// plus a soft CRT-glass vignette
function tone(v, x, y) {
  const g = v ** (1 / 2.2);
  const t = g < 0.62 ? g : 0.62 + (g - 0.62) * 0.62;
  const dx = x - 0.5, dy = y - 0.5;
  const vig = 1 - 0.55 * Math.min(1, (dx * dx + dy * dy) * 1.6) ** 1.6;
  return Math.min(1, Math.max(0, t * vig * 1.06));
}

// display-gamma luminance, dw×dh, cropped to the requested aspect
function resample(dw, dh, aspect) {
  const img = source();
  const c = cropFor(aspect);
  const tx = taps(c.x, c.w, dw);
  const ty = taps(c.y, c.h, dh);

  const tmp = new Float32Array(dw * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const row = y * SIZE;
    for (let x = 0; x < dw; x++) {
      const { lo, ws } = tx[x];
      let acc = 0;
      for (let k = 0; k < ws.length; k++) acc += img[row + lo + k] * ws[k];
      tmp[y * dw + x] = acc;
    }
  }

  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const { lo, ws } = ty[y];
    for (let x = 0; x < dw; x++) {
      let acc = 0;
      for (let k = 0; k < ws.length; k++) acc += tmp[(lo + k) * dw + x] * ws[k];
      out[y * dw + x] = tone(Math.max(0, acc), (x + 0.5) / dw, (y + 0.5) / dh);
    }
  }
  return out;
}

const luts = new WeakMap();
function lutFor(theme) {
  if (!luts.has(theme)) {
    const lut = new Array(256);
    const n = theme.ramp.length - 1;
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * n;
      const k = Math.min(n - 1, Math.floor(t));
      lut[i] = mix(theme.ramp[k], theme.ramp[k + 1], t - k);
    }
    luts.set(theme, lut);
  }
  return luts.get(theme);
}

const GRAY = Array.from({ length: 256 }, (_, i) => [i, i, i]);

const cache = new Map();
function remember(key, make) {
  if (!cache.has(key)) {
    if (cache.size > 16) cache.clear();
    cache.set(key, make());
  }
  return cache.get(key);
}

// unsharp mask — restores the edge contrast lost when 512px becomes ~80
function sharpen(px, w, h, amount) {
  const out = new Float32Array(px.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w, y1 = y * w, y2 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x2 = Math.min(w - 1, x + 1);
      const blur =
        (px[y0 + x0] + 2 * px[y0 + x] + px[y0 + x2] +
          2 * px[y1 + x0] + 4 * px[y1 + x] + 2 * px[y1 + x2] +
          px[y2 + x0] + 2 * px[y2 + x] + px[y2 + x2]) / 16;
      const v = px[y1 + x];
      out[y1 + x] = Math.min(1, Math.max(0, v + (v - blur) * amount));
    }
  }
  return out;
}

// every way to split a 2×2 cell into two tones; bits: TL=8 TR=4 BL=2 BR=1,
// set bits take the foreground color. ▀ comes first so flat areas use it
const QUADS = [
  [12, "▀"], [10, "▌"], [8, "▘"], [4, "▝"], [2, "▖"], [1, "▗"], [9, "▚"],
];

// pick the split (and its two mean tones) with the least squared error
function fitCell(a, b, c, d) {
  const v = [a, b, c, d];
  let best = null;
  for (const [mask, ch] of QUADS) {
    let fs = 0, fn = 0, bs = 0, bn = 0;
    for (let i = 0; i < 4; i++) {
      if (mask & (8 >> i)) { fs += v[i]; fn++; } else { bs += v[i]; bn++; }
    }
    const f = fs / fn, g = bs / bn;
    let err = 0;
    for (let i = 0; i < 4; i++) err += (v[i] - (mask & (8 >> i) ? f : g)) ** 2;
    if (!best || err < best.err - 1e-6) best = { err, ch, f, g };
  }
  return best;
}

// `rows` strings of quadrant-block art, each `cols` cells wide — every cell
// carries 2×2 pixels, twice the horizontal detail of plain half blocks.
// cellRatio = cell width / cell height (0.5 on a typical terminal font)
export function avatarLines(cols, rows, theme, P, cellRatio = 0.5) {
  const aspect = (cols * cellRatio) / rows;
  return remember(`blk:${cols}x${rows}:${theme.id}:${P.level}:${aspect.toFixed(3)}`, () => {
    const W = cols * 2;
    const px = sharpen(resample(W, rows * 2, aspect), W, rows * 2, 0.55);
    // xterm-256 can't hold a phosphor gradient without banding into odd hues,
    // its 24-step gray ramp renders the photo far more faithfully
    const lut = P.level >= 3 ? lutFor(theme) : GRAY;
    const color = (v) => lut[Math.round(v * 255)];
    const lines = [];
    for (let y = 0; y < rows; y++) {
      const top = y * 2 * W, bot = (y * 2 + 1) * W;
      let line = "";
      let lastF = "", lastB = "";
      for (let x = 0; x < cols; x++) {
        const i = x * 2;
        const cell = fitCell(px[top + i], px[top + i + 1], px[bot + i], px[bot + i + 1]);
        const f = P.fg(color(cell.f));
        const b = P.bg(color(cell.g));
        if (f !== lastF) line += lastF = f;
        if (b !== lastB) line += lastB = b;
        line += cell.ch;
      }
      lines.push(line + "\x1b[0m");
    }
    return lines;
  });
}

// full-resolution tinted PNG for kitty / iTerm2 graphics
export function avatarPNG(cols, rows, theme, cellRatio = 0.5) {
  const aspect = (cols * cellRatio) / rows;
  return remember(`png:${theme.id}:${aspect.toFixed(3)}`, () => {
    const w = Math.round(aspect >= 1 ? SIZE : SIZE * aspect);
    const h = Math.round(aspect >= 1 ? SIZE / aspect : SIZE);
    const px = resample(w, h, aspect);
    const lut = lutFor(theme);
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < px.length; i++) rgb.set(lut[Math.round(px[i] * 255)], i * 3);
    return encodePNG(w, h, rgb).toString("base64");
  });
}
