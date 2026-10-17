// ─────────────────────────────────────────────────────────────
// view — pure functions from (state, terminal size) to lines.
//
// A line is an array of segments: { t, fg, bg, b } for text, or
// { raw, w } for pre-encoded ANSI (the avatar). `bg: undefined`
// means "inherit from whatever this line is placed on".
// ─────────────────────────────────────────────────────────────

import { width, clip, padEnd, padStart } from "./text.js";
import { bigText } from "./font.js";
import { avatarLines } from "./avatar.js";
import { mix } from "./paint.js";

const seg = (t, fg, bg, b) => ({ t, fg, bg, b });
const raw = (r, w) => ({ raw: r, w });

const segW = (s) => (s.raw != null ? s.w : width(s.t));
const lineWidth = (line) => line.reduce((w, s) => w + segW(s), 0);

function fit(line, max) {
  const out = [];
  let w = 0;
  for (const s of line) {
    const sw = segW(s);
    if (w + sw <= max) {
      out.push(s);
      w += sw;
      continue;
    }
    if (s.raw == null && max - w > 0) out.push({ ...s, t: clip(s.t, max - w) });
    break;
  }
  return out;
}

function padLine(line, w, bg) {
  const lw = lineWidth(line);
  if (lw > w) return fit(line, w);
  return lw === w ? line : [...line, seg(" ".repeat(w - lw), null, bg)];
}

const withBg = (line, bg) =>
  line.map((s) => (s.raw != null || s.bg !== undefined ? s : { ...s, bg }));

const center = (line, w) => [seg(" ".repeat(Math.max(0, Math.floor((w - lineWidth(line)) / 2)))), ...line];

// striped lettering, each bar a step further from `a` toward `b`
function stripes(rows, a, b) {
  const n = Math.max(1, rows.length - 1);
  return rows.map((r, i) => [seg(r, mix(a, b, i / n))]);
}

export function renderLine(line, P) {
  if (!P.level) return line.map((s) => (s.raw != null ? " ".repeat(s.w) : s.t)).join("");
  let out = "";
  for (const s of line) {
    if (s.raw != null) {
      out += s.raw;
      continue;
    }
    out += "\x1b[0m" + (s.bg ? P.bg(s.bg) : "") + (s.fg ? P.fg(s.fg) : "") + (s.b ? "\x1b[1m" : "") + s.t;
  }
  return out + "\x1b[0m";
}

// ─────────────────────────────────────────────────────────────
// data shaping
// ─────────────────────────────────────────────────────────────
const bare = (url) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export function linksOf(d, calendar) {
  const L = [{ key: "g", label: "github", value: `github.com/${d.login}`, url: `https://github.com/${d.login}` }];
  if (d.blog) {
    const url = /^https?:\/\//.test(d.blog) ? d.blog : `https://${d.blog}`;
    L.push({ key: "w", label: "web", value: bare(d.blog), url });
  }
  if (d.twitter) L.push({ key: "x", label: "x", value: bare(d.twitter).replace(/^twitter\.com/, "x.com"), url: d.twitter });
  if (d.linkedin) L.push({ key: "l", label: "linkedin", value: bare(d.linkedin), url: d.linkedin });
  if (d.email) L.push({ key: "m", label: "mail", value: d.email, url: `mailto:${d.email}` });
  if (calendar) L.push({ key: "c", label: "calendar", value: bare(calendar), url: calendar });
  return L;
}

function short(date, now) {
  const s = Math.max(0, Math.floor((now - date) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

function signal(d, now) {
  if (!d.online) return { label: "OFFLINE", level: 0 };
  const last = d.activity[0]?.at;
  if (!last) return { label: "QUIET", level: 2 };
  const h = (now - last) / 3.6e6;
  if (h < 24) return { label: "ON AIR", level: 10, last };
  if (h < 168) return { label: "ACTIVE", level: 6, last };
  return { label: "IDLE", level: 3, last };
}

// ─────────────────────────────────────────────────────────────
// info column
// ─────────────────────────────────────────────────────────────
function rule(label, w, th) {
  return [
    seg("── ", th.faint),
    seg(label, th.dim, undefined, true),
    seg(" " + "─".repeat(Math.max(0, w - width(label) - 4)), th.faint),
  ];
}

function linkRow(l, on, w, th) {
  const label = padEnd(l.label, 10);
  if (on) {
    const bg = th.fg;
    const fg = th.panel || [0, 0, 0];
    return padLine(
      [seg(" ▸ ", fg, bg, true), seg(l.key, fg, bg, true), seg("  " + label, fg, bg, true), seg(clip(l.value, w - 16), fg, bg)],
      w,
      bg,
    );
  }
  return [seg("   "), seg(l.key, th.accent, undefined, true), seg("  " + label, th.fg), seg(l.value, th.dim)];
}

function statusRow(ctx) {
  const { d, th, now, t } = ctx;
  const s = signal(d, now);
  const hot = s.level >= 10;
  const blink = hot && !ctx.static && Math.floor(t / 650) % 2 === 1;
  const col = hot ? th.live : s.level ? th.fg : th.faint;
  const row = [
    seg(blink ? "○" : "●", col),
    seg(" " + padEnd(s.label, 9), col, undefined, true),
    seg("▰".repeat(s.level), col),
    seg("▱".repeat(10 - s.level), th.faint),
  ];
  if (s.last) {
    const ago = short(s.last, now);
    row.push(seg(ago === "now" ? "  seen just now" : `  seen ${ago} ago`, th.dim));
  } else if (!d.online) {
    row.push(seg("  cached card", th.dim));
  }
  return row;
}

function activityRow(a, w, th, now) {
  const room = Math.max(4, w - 16);
  return [
    seg(a.icon, th.accent),
    seg(" " + padEnd(a.verb, 8) + " ", th.dim),
    seg(padEnd(clip(a.repo, room), room), th.fg),
    seg(" " + padStart(short(a.at, now), 4), th.faint),
  ];
}

function statsRow(d, th, sep) {
  const dot = seg(sep, th.faint);
  const row = [seg(String(d.repos), th.bright, undefined, true), seg(" repos", th.dim)];
  if (d.followers != null) row.push(dot, seg(String(d.followers), th.bright, undefined, true), seg(" followers", th.dim));
  if (d.since) row.push(dot, seg("since ", th.dim), seg(String(d.since), th.bright, undefined, true));
  return row;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// days → Sunday-first week columns, as on github.com, oldest first
function weeksOf(days) {
  const weeks = [];
  for (const day of days) {
    const dow = new Date(day.date + "T00:00:00Z").getUTCDay();
    if (!weeks.length || dow === 0) weeks.push(new Array(7).fill(null));
    weeks[weeks.length - 1][dow] = day;
  }
  return weeks;
}

const monthOf = (week) => {
  const day = week.find(Boolean);
  return day ? +day.date.slice(5, 7) - 1 : -1;
};

// the contribution graph, as many recent weeks as fit in `w` cells.
// roomy: one ■ per day with gaps and month labels (8 rows);
// dense: two days per cell stacked with ▀/▄ (4 rows)
function heatmap(cal, w, th, dense, mono) {
  const shades = [th.faint, mix(th.faint, th.fg, 0.4), mix(th.faint, th.fg, 0.7), th.fg, th.bright];
  // without color the level has to live in the glyph itself
  const cellOf = (level) => seg(mono ? "·░▒▓█"[level] : "■", shades[level]);
  const all = weeksOf(cal.days);
  const weeks = all.slice(-Math.min(all.length, dense ? w : Math.floor((w + 1) / 2)));
  const L = [];

  if (dense && !mono) {
    for (let r = 0; r < 4; r++) {
      L.push(
        weeks.map((wk) => {
          const top = wk[r * 2], bot = wk[r * 2 + 1];
          if (!top && !bot) return seg(" ");
          if (!top) return seg("▄", shades[bot.level]);
          return seg("▀", shades[top.level], bot ? shades[bot.level] : undefined);
        }),
      );
    }
  } else {
    let labels = "";
    weeks.forEach((wk, i) => {
      const m = monthOf(wk);
      const fresh = i === 0 || m !== monthOf(weeks[i - 1]);
      if (m >= 0 && fresh && (i === 0 || labels.length < i * 2)) labels = labels.padEnd(i * 2) + MONTHS[m];
    });
    L.push([seg(labels, th.dim)]);
    for (let d = 0; d < 7; d++) {
      L.push(weeks.flatMap((wk, i) => [...(i ? [seg(" ")] : []), wk[d] ? cellOf(wk[d].level) : seg(" ")]));
    }
  }

  const total = cal.total != null
    ? [seg(cal.total.toLocaleString("en-US"), th.bright, undefined, true), seg(" contributions in the last year", th.dim)]
    : [seg("contributions in the last year", th.dim)];
  const legend = [seg("less ", th.faint), ...shades.map((_, i) => cellOf(i)), seg(" more", th.faint)];
  L.push(spread(total, legend, w) || total);
  return L;
}

function buildInfo(ctx, w, o) {
  const { d, th, now, links, sel } = ctx;
  const L = [];

  const spaced = [...d.name.toUpperCase()].join(" ");
  L.push([seg(width(spaced) <= w ? spaced : d.name.toUpperCase(), th.bright, undefined, true)]);

  const handle = [seg("@" + d.login, th.fg, undefined, true)];
  if (d.location) handle.push(seg("  ·  ", th.faint), seg(d.location, th.dim));
  L.push(handle);
  if (o.bio && d.bio) L.push([seg(d.bio, th.dim)]);

  L.push([]);
  L.push(rule("LINKS", w, th));
  links.forEach((l, i) => L.push(linkRow(l, i === sel && !ctx.static, w, th)));

  if (o.signal >= 0) {
    L.push([]);
    L.push(rule("SIGNAL", w, th));
    L.push(statusRow(ctx));
    for (const a of d.activity.slice(0, o.signal)) L.push(activityRow(a, w, th, now));
  }

  if (o.heat && d.calendar) {
    L.push([]);
    L.push(rule("CONTRIBUTIONS", w, th));
    L.push(...heatmap(d.calendar, w, th, o.heat === "dense", !ctx.P.level));
  }

  if (o.stats && d.repos != null) {
    L.push([]);
    const roomy = statsRow(d, th, "  ·  ");
    L.push(lineWidth(roomy) <= w ? roomy : statsRow(d, th, " · "));
  }

  return L.map((l) => fit(l, w));
}

// richest → leanest; the first one that fits the height wins
const VARIANTS = [
  { bio: true, signal: 3, stats: true, heat: "grid" },
  { bio: true, signal: 2, stats: true, heat: "grid" },
  { bio: true, signal: 3, stats: true, heat: "dense" },
  { bio: true, signal: 2, stats: true, heat: "dense" },
  { bio: true, signal: 1, stats: true, heat: "dense" },
  { bio: true, signal: 0, stats: false, heat: "dense" },
  { bio: true, signal: 3, stats: true },
  { bio: true, signal: 2, stats: true },
  { bio: true, signal: 1, stats: false },
  { bio: true, signal: 0, stats: false },
  { bio: false, signal: -1, stats: false },
];

function pickInfo(ctx, w, maxH) {
  let lines = [];
  for (const v of VARIANTS) {
    lines = buildInfo(ctx, w, v);
    if (lines.length <= maxH) return { lines, fits: true };
  }
  return { lines, fits: false };
}

// ─────────────────────────────────────────────────────────────
// card
// ─────────────────────────────────────────────────────────────
function topBorder(ctx, w) {
  const { th, d } = ctx;
  const B = th.border;
  const left = [seg("╭─", B), seg(" ◆ ", th.accent), seg(d.login.toUpperCase() + ".SYS", th.bright, undefined, true), seg(" ", B)];
  const end = [seg("─╮", B)];
  const options = [];
  if (!ctx.static) {
    const clock = ctx.now.toTimeString().slice(0, 8);
    options.push([seg(` v${ctx.version} `, th.dim), seg("─", B), seg(` ${clock} `, th.fg)]);
    options.push([seg(` ${clock} `, th.fg)]);
  } else {
    options.push([seg(` v${ctx.version} `, th.dim)]);
  }
  options.push([]);
  for (const right of options) {
    const fill = w - lineWidth(left) - lineWidth(right) - lineWidth(end);
    if (fill >= 1) return [...left, seg("─".repeat(fill), B), ...right, ...end];
  }
  return fit([...left, seg("─".repeat(w), B)], w - 1).concat(end);
}

function spread(left, right, w) {
  const gap = w - lineWidth(left) - lineWidth(right);
  return gap >= 2 ? [...left, seg(" ".repeat(gap)), ...right] : null;
}

function footer(ctx, w) {
  const { th } = ctx;
  if (ctx.static) {
    const left = [seg("❯ ", th.accent), seg("npx " + ctx.d.login, th.fg, undefined, true)];
    return spread(left, [seg(ctx.signOff, th.dim)], w) || left;
  }

  const right = ctx.toast ? [seg(ctx.toast, th.accent, undefined, true)] : [seg(th.label, th.faint)];
  const hints = (keys, words) =>
    keys.flatMap(([k, desc], i) => [
      ...(i ? [seg(words ? "   " : " · ", th.faint)] : []),
      seg(k, th.bright, undefined, true),
      ...(words ? [seg(" " + desc, th.dim)] : []),
    ]);
  const KEYS = [["↑↓", "move"], ["↵", "open"], ["p", "photo"], ["t", "theme"], ["q", "quit"]];

  return (
    spread(hints(KEYS, true), right, w) ||
    (ctx.toast ? spread(hints(KEYS, false), right, w) : null) ||
    spread(hints(KEYS, true), [], w) ||
    fit(hints(KEYS, false), w)
  );
}

export function buildCard(ctx) {
  const { C, R, th, P } = ctx;
  const margin = C >= 100 ? 4 : C >= 64 ? 2 : 0;
  const maxW = Math.min(C - margin * 2, 136);
  const Wi = maxW - 4; // inside the borders and their one-cell padding
  const chrome = 7; // top, blank, blank, divider, footer, bottom (+1 breathing room)
  const vMargin = ctx.static ? 0 : R >= 34 ? 2 : R >= 26 ? 1 : 0;
  const availBody = Math.max(1, R - chrome - vMargin * 2);
  const hasImg = P.level > 0;
  const gap = Wi >= 96 ? 5 : 3;
  const MIN_INFO = 40;

  // a square photo is `rows / cell` columns wide, whatever the font's shape
  const cell = ctx.cell || 0.5;
  const colsOf = (rows) => Math.round(rows / cell);

  let layout = null;
  if (hasImg) {
    let rows = Math.min(availBody, 42, Math.floor((Wi - gap - MIN_INFO) * cell));
    if (ctx.static) rows = Math.min(rows, 20);
    if (rows >= 10) {
      const cols = colsOf(rows);
      const Iw = Math.min(Wi - cols - gap, 60);
      layout = { kind: "side", rows, cols, Iw, info: pickInfo(ctx, Iw, Math.max(rows, availBody)).lines };
    }
  }
  if (!layout) {
    const Iw = Math.min(Wi, 60);
    let info = hasImg ? pickInfo(ctx, Iw, availBody - 9) : { fits: false };
    let rows = 0;
    if (info.fits) rows = Math.min(availBody - info.lines.length - 1, Math.floor(Wi * cell), ctx.static ? 14 : 26);
    if (rows < 8) {
      rows = 0;
      info = pickInfo(ctx, Iw, availBody);
    }
    layout = { kind: "stack", rows, cols: colsOf(rows), Iw, info: info.lines };
  }

  const { kind, rows, cols, Iw, info } = layout;
  let innerW = kind === "side" ? cols + gap + Iw : Math.max(cols, Iw);
  innerW = Math.max(innerW, Math.min(Wi, 58));

  // intro animation: the photo is "scanned" in, text lines arrive one by one.
  // once it settles, graphics-capable terminals get real pixels on top
  const t = ctx.static ? Infinity : ctx.t;
  const scan = Math.min(1, t / 700);
  const shownRows = Math.floor(scan * rows);
  const pixels = Boolean(ctx.gfx) && !ctx.static && scan >= 1;
  const pic = rows && !pixels ? avatarLines(cols, rows, th, P, cell) : [];
  const beam = P.fg(th.bright) + P.bg(th.fg) + "▀".repeat(cols) + "\x1b[0m";
  const hole = raw(`\x1b[${cols}C`, cols); // leave the cells to the image
  const avatarRow = (y) =>
    pixels ? hole
    : y < shownRows ? raw(pic[y], cols)
    : y === shownRows && scan < 1 ? raw(beam, cols)
    : seg(" ".repeat(cols));
  const infoRow = (i) => (t >= 150 + i * 32 ? info[i] : []);

  const body = [];
  let img = null;
  if (kind === "side") {
    const h = Math.max(rows, info.length);
    const aTop = Math.floor((h - rows) / 2);
    const iTop = Math.floor((h - info.length) / 2);
    img = { x: 2, y: 2 + aTop, cols, rows };
    for (let y = 0; y < h; y++) {
      const a = y - aTop, i = y - iTop;
      const left = a >= 0 && a < rows ? avatarRow(a) : seg(" ".repeat(cols));
      const right = i >= 0 && i < info.length ? infoRow(i) : [];
      body.push([left, seg(" ".repeat(gap)), ...padLine(right, Iw)]);
    }
  } else {
    const offW = Math.floor((innerW - cols) / 2);
    if (rows) img = { x: 2 + offW, y: 2, cols, rows };
    for (let y = 0; y < rows; y++) body.push([seg(" ".repeat(offW)), avatarRow(y)]);
    if (rows) body.push([]);
    const infoOff = seg(" ".repeat(Math.floor((innerW - Iw) / 2)));
    info.forEach((_, i) => body.push([infoOff, ...infoRow(i)]));
  }

  const B = th.border;
  const w = innerW + 4;
  const inside = (content) => [
    seg("│", B),
    ...withBg([seg(" "), ...padLine(content, innerW), seg(" ")], th.panel),
    seg("│", B),
  ];
  const lines = [
    topBorder(ctx, w),
    inside([]),
    ...body.map(inside),
    inside([]),
    [seg("├" + "─".repeat(w - 2) + "┤", B)],
    inside(footer(ctx, innerW)),
    [seg("╰" + "─".repeat(w - 2) + "╯", B)],
  ];
  return { lines, w, h: lines.length, img: pixels || ctx.static ? img : null };
}

// ─────────────────────────────────────────────────────────────
// boot + photo screens
// ─────────────────────────────────────────────────────────────
export const BOOT_STEPS_END = 950;

export function buildBoot(ctx) {
  const { th, P, t, ready, d, C, R } = ctx;
  const W = Math.max(20, Math.min(60, C - 4));
  const L = [];

  const logo = [2, 1].map((s) => bigText("ZACKHA", s)).find((l) => l && width(l[0]) <= W);
  if (logo) L.push(...stripes(logo, th.bright, th.accent), []);
  L.push([seg(`BIOS v${ctx.version}  ·  (C) 1986–2026`, th.dim)]);
  L.push([]);

  const spin = "◐◓◑◒"[Math.floor(t / 110) % 4];
  const depth = P.level >= 3 ? "24-BIT" : P.level >= 2 ? "256 COLOR" : "16 COLOR";
  const progress = Math.max(0, Math.min(ready ? 1 : 0.86, (t - BOOT_STEPS_END) / 420));
  const cells = 16;
  const filled = Math.round(progress * cells);
  const bar = [seg("▰".repeat(filled), th.fg), seg("▱".repeat(cells - filled), th.faint)];
  const hand = progress >= 1 ? (d?.online ? "OK" : "CACHED") : spin;

  const steps = [
    [150, "CPU", [seg("Z80A @ 4.00 MHZ", th.fg)], "OK"],
    [280, "MEMORY", [seg("640K CONVENTIONAL", th.fg)], "OK"],
    [410, "DISPLAY", [seg(`${depth} · ${C}×${R}`, th.fg)], "OK"],
    [560, "MODEM", [seg("ATDT API.GITHUB.COM", th.fg)], t > 820 ? "OK" : spin],
    [820, "CARRIER", [seg("CONNECT 9600/ARQ", th.fg)], "OK"],
    [BOOT_STEPS_END, "HANDSHAKE", bar, hand],
  ];

  for (const [at, label, value, status] of steps) {
    if (t < at) break;
    const dots = label + " " + ".".repeat(Math.max(2, 11 - label.length)) + " ";
    const left = [seg(dots, th.dim), ...value];
    const okCol = status === "OK" ? th.live : status === "CACHED" ? th.dim : th.fg;
    L.push(spread(left, [seg(status, okCol, undefined, true)], W) || fit(left, W));
  }

  if (Math.floor(t / 420) % 2 === 0) L.push([seg("█", th.fg)]);
  else L.push([]);

  return { lines: L.map((l) => padLine(fit(l, W), W)), w: W, h: L.length };
}

export function buildPhoto(ctx) {
  const { C, R, th, P, d } = ctx;
  if (!P.level) {
    const msg = [seg("photo mode needs a color terminal", th.dim)];
    return { lines: [msg], w: lineWidth(msg), h: 1 };
  }
  const cell = ctx.cell || 0.5;
  const rows = Math.max(2, Math.min(R - 3, Math.floor((C - 2) * cell)));
  const cols = Math.min(C, Math.round(rows / cell));
  const L = ctx.gfx
    ? Array.from({ length: rows }, () => [raw(`\x1b[${cols}C`, cols)])
    : avatarLines(cols, rows, th, P, cell).map((r) => [raw(r, cols)]);
  const caption = [
    seg(d.name.toUpperCase(), th.bright, undefined, true),
    seg("  ·  ", th.faint),
    seg("@" + d.login, th.dim),
    seg("  ·  ", th.faint),
    seg("p", th.bright, undefined, true),
    seg(" back  ", th.dim),
    seg("t", th.bright, undefined, true),
    seg(" theme  ", th.dim),
    seg("q", th.bright, undefined, true),
    seg(" quit", th.dim),
  ];
  const w = Math.max(cols, Math.min(C, lineWidth(caption)));
  L.push([]);
  L.push(fit(caption, w));
  const img = ctx.gfx ? { x: Math.floor((w - cols) / 2), y: 0, cols, rows } : null;
  return { lines: L.map((l) => center(l, w)), w, h: L.length, img };
}

// place a block in the middle of a C×R screen painted with CRT scanlines.
// `screen.img` is where the block's photo landed, if it asked for pixels
export function compose(ctx, block) {
  const { C, R, th } = ctx;
  const top = Math.max(0, Math.floor((R - block.h) / 2));
  const left = Math.max(0, Math.floor((C - block.w) / 2));
  const lines = [];
  for (let y = 0; y < R; y++) {
    const row = block.lines[y - top];
    const line = row ? [seg(" ".repeat(left)), ...row] : [];
    lines.push(withBg(padLine(line, C), y % 2 ? th.scan : th.bg));
  }
  const b = block.img;
  const img = b && top + b.y + b.rows < R && left + b.x + b.cols <= C ? { ...b, x: left + b.x, y: top + b.y } : null;
  return { lines, img };
}

// card for scrollback: no screen background, indented two cells.
// `img` marks the half-block photo so it can be overprinted with pixels
export function staticCard(ctx) {
  const card = buildCard(ctx);
  const lines = card.lines.map((l) => withBg([seg("  "), ...l], null));
  return { lines, img: card.img && { ...card.img, x: card.img.x + 2 } };
}
