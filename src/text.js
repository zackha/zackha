// ─────────────────────────────────────────────────────────────
// display-width helpers — terminal cells, not string length
// ─────────────────────────────────────────────────────────────

function cpWidth(cp) {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  ) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

export function width(s) {
  let w = 0;
  for (const ch of s) w += cpWidth(ch.codePointAt(0));
  return w;
}

// cut to `max` cells, ending in an ellipsis when something was dropped
export function clip(s, max) {
  if (max <= 0) return "";
  if (width(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = cpWidth(ch.codePointAt(0));
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

export function padEnd(s, n) {
  const w = width(s);
  return w >= n ? s : s + " ".repeat(n - w);
}

export function padStart(s, n) {
  const w = width(s);
  return w >= n ? s : " ".repeat(n - w) + s;
}
