// ─────────────────────────────────────────────────────────────
// color output — truecolor when available, xterm-256 otherwise
// ─────────────────────────────────────────────────────────────

const CUBE = [0, 95, 135, 175, 215, 255];

function to256([r, g, b]) {
  const q = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  const qr = q(r), qg = q(g), qb = q(b);
  const dc = (CUBE[qr] - r) ** 2 + (CUBE[qg] - g) ** 2 + (CUBE[qb] - b) ** 2;
  const avg = (r + g + b) / 3;
  const gi = avg > 238 ? 23 : Math.max(0, Math.round((avg - 8) / 10));
  const gv = 8 + gi * 10;
  const dg = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;
  return dg < dc ? 232 + gi : 16 + 36 * qr + 6 * qg + qb;
}

export function makePainter(level) {
  if (level >= 3) {
    return {
      level,
      fg: (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`,
      bg: (c) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`,
    };
  }
  if (level >= 1) {
    return {
      level,
      fg: (c) => `\x1b[38;5;${to256(c)}m`,
      bg: (c) => `\x1b[48;5;${to256(c)}m`,
    };
  }
  return { level: 0, fg: () => "", bg: () => "" };
}

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
