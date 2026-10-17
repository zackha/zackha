#!/usr/bin/env node

/**
 * ZACKHA.SYS — a phosphor-lit BBS terminal that happens to live in 2026.
 *
 *   npx zackha                 interactive full-screen card
 *   npx zackha --theme green   amber | green | ice | paper
 *   npx zackha --static        print the card and exit
 *   npx zackha --fast          skip the boot sequence
 *   npx zackha --blocks        block-art photo even where pixels are possible
 *   npx zackha --pixels        force inline-image pixels (e.g. VS Code with
 *                              terminal.integrated.enableImages turned on)
 */

import chalk from "chalk";
import open from "open";
import os from "node:os";
import { createRequire } from "node:module";
import { USERNAME, CALENDAR, FALLBACK } from "./config.js";
import { loadProfile } from "./src/github.js";
import { THEMES, transparent } from "./src/themes.js";
import { makePainter } from "./src/paint.js";
import { avatarPNG } from "./src/avatar.js";
import { detectGraphics, placeImage, clearImages } from "./src/graphics.js";
import { buildBoot, buildCard, buildPhoto, compose, linksOf, renderLine, staticCard, BOOT_STEPS_END } from "./src/view.js";

const { version } = createRequire(import.meta.url)("./package.json");

// ─────────────────────────────────────────────────────────────
// options
// ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const themeArg = argv[argv.indexOf("--theme") + 1] || argv.find((a) => a.startsWith("--theme="))?.slice(8);

let themeIdx = Math.max(0, THEMES.findIndex((t) => t.id === themeArg));
// Terminal.app gained 24-bit color in macOS 26 (Darwin 25), chalk still assumes 256
const appleTruecolor = process.env.TERM_PROGRAM === "Apple_Terminal" && parseInt(os.release()) >= 25;
const P = makePainter(chalk.level === 2 && appleTruecolor ? 3 : chalk.level);
const out = process.stdout;
const interactive = out.isTTY && process.stdin.isTTY && !flag("static");
const gfx = !out.isTTY || P.level === 0 || flag("blocks") ? null : flag("pixels") ? "iterm" : detectGraphics();
let cell = 0.5; // cell width / height, refined by asking the terminal

const SIGN_OFFS = ["NO CARRIER", "CONNECTION CLOSED", "73 DE ZACKHA", "LOGGED OFF", "+++ATH0"];
const signOff = SIGN_OFFS[Math.floor(Math.random() * SIGN_OFFS.length)];

function printStatic(data) {
  const ctx = {
    d: data,
    th: transparent(THEMES[themeIdx]),
    P,
    C: Math.max(40, Math.min(out.columns || 96, 112)),
    R: 30,
    now: new Date(),
    t: Infinity,
    links: linksOf(data, CALENDAR),
    version,
    static: true,
    signOff,
    cell,
  };
  const { lines, img } = staticCard(ctx);
  out.write("\n" + lines.map((l) => renderLine(l, P)).join("\n") + "\n");
  // overprint the half-block photo with real pixels, if it's all on screen
  if (gfx && img && (out.rows || 0) > lines.length + 2) {
    const up = lines.length - img.y;
    const png = avatarPNG(img.cols, img.rows, ctx.th, cell);
    out.write(`\x1b7\x1b[${up}A\x1b[${img.x + 1}G` + placeImage(gfx, png, img.cols, img.rows) + "\x1b8");
  }
  out.write("\n");
}

// ─────────────────────────────────────────────────────────────
// non-interactive: pipes, CI, --static
// ─────────────────────────────────────────────────────────────
if (!interactive) {
  printStatic(await loadProfile(USERNAME, FALLBACK));
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// interactive session
// ─────────────────────────────────────────────────────────────
const state = {
  phase: "boot", // boot → main ⇄ photo
  start: Date.now(),
  mainAt: 0,
  skip: flag("fast"),
  data: null,
  readyAt: 0,
  sel: 0,
  toast: null,
};

loadProfile(USERNAME, FALLBACK).then((d) => {
  state.data = d;
  state.readyAt = Date.now();
  schedule(0);
});

let prev = [];
let placed = null; // what the inline image currently shows
let timer = null;
let alive = true;

function restoreTerminal() {
  out.write("\x1b[?2026l\x1b[0m" + clearImages(gfx) + "\x1b[?25h\x1b[?1049l");
}

// alt screen, hidden cursor, and a request for the cell size in pixels
out.write("\x1b[?1049h\x1b[?25l\x1b[2J" + (gfx ? "\x1b[16t" : ""));
process.on("exit", () => alive && restoreTerminal());
process.on("SIGTERM", () => quit());

function frame() {
  const C = out.columns || 80;
  const R = out.rows || 24;
  const now = Date.now();
  const th = THEMES[themeIdx];
  const base = { th, P, C, R, version, now: new Date(now), cell, gfx };

  if (state.phase === "boot") {
    const t = now - state.start;
    const ready = Boolean(state.data);
    const done = ready && (state.skip || (t >= BOOT_STEPS_END + 520 && now - state.readyAt >= 250));
    if (!done) return compose(base, buildBoot({ ...base, t, ready, d: state.data }));
    state.phase = "main";
    state.mainAt = now;
  }

  if (state.toast && now > state.toast.until) state.toast = null;
  const ctx = {
    ...base,
    d: state.data,
    t: now - state.mainAt,
    links: linksOf(state.data, CALENDAR),
    sel: state.sel,
    toast: state.toast?.text,
  };
  return compose(ctx, state.phase === "photo" ? buildPhoto(ctx) : buildCard(ctx));
}

function draw() {
  const screen = frame();
  const lines = screen.lines.map((l) => renderLine(l, P));
  let buf = "\x1b[?2026h";
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== prev[i]) buf += `\x1b[${i + 1};1H` + lines[i];
  }
  prev = lines;

  const { img } = screen;
  const th = THEMES[themeIdx];
  const key = img ? `${img.x},${img.y},${img.cols},${img.rows},${th.id},${cell}` : null;
  if (gfx && key !== placed) {
    buf += clearImages(gfx);
    if (img) buf += `\x1b[${img.y + 1};${img.x + 1}H` + placeImage(gfx, avatarPNG(img.cols, img.rows, th, cell), img.cols, img.rows);
    placed = key;
  }
  out.write(buf + "\x1b[?2026l");
}

// fast ticks while something is moving, slow ones for the clock and pulse
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!alive) return;
    draw();
    const animating = state.phase === "boot" || Date.now() - state.mainAt < 1400;
    schedule(animating ? 33 : 250);
  }, ms);
}

out.on("resize", () => {
  prev = [];
  placed = null;
  out.write("\x1b[2J");
  schedule(0);
});

// ─────────────────────────────────────────────────────────────
// input
// ─────────────────────────────────────────────────────────────
function quit() {
  alive = false;
  clearTimeout(timer);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  restoreTerminal();
  if (state.data) printStatic(state.data);
  process.exit(0);
}

function openLink(link) {
  state.toast = { text: `↗ ${link.value}`, until: Date.now() + 2200 };
  open(link.url).catch(() => {
    state.toast = { text: "✕ could not open browser", until: Date.now() + 2200 };
  });
}

function onKey(input) {
  // the terminal's answer to \x1b[16t: \x1b[6;<height>;<width>t
  const s = input.replace(/\x1b\[6;(\d+);(\d+)t/g, (_, h, w) => {
    if (+h > 0 && +w > 0) cell = +w / +h;
    prev = [];
    placed = null;
    return "";
  });
  if (!s) return schedule(0);
  if (s === "\x03" || s === "\x04") return quit();

  if (state.phase === "boot") {
    if (s === "q") return quit();
    state.skip = true;
    return schedule(0);
  }

  if (s === "t") {
    themeIdx = (themeIdx + 1) % THEMES.length;
    state.toast = { text: `◆ ${THEMES[themeIdx].label}`, until: Date.now() + 1500 };
  } else if (state.phase === "photo") {
    if (s === "q") return quit();
    if (s === "p" || s === "\x1b" || s === "\r") state.phase = "main";
  } else {
    const links = linksOf(state.data, CALENDAR);
    const hot = links.findIndex((l) => l.key === s.toLowerCase());
    if (s === "q" || s === "\x1b") return quit();
    if (s === "\x1b[A" || s === "k" || s === "\x1b[Z") state.sel = (state.sel - 1 + links.length) % links.length;
    else if (s === "\x1b[B" || s === "j" || s === "\t") state.sel = (state.sel + 1) % links.length;
    else if (s === "\r" || s === " ") openLink(links[state.sel]);
    else if (s === "p") state.phase = "photo";
    else if (hot >= 0) {
      state.sel = hot;
      openLink(links[hot]);
    }
  }
  schedule(0);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", onKey);
schedule(0);
