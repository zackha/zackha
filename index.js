#!/usr/bin/env node

/**
 * ZACKHA.SYS — a 1980s BBS terminal that happens to live in 2026.
 *
 * Layout: ID card. Avatar lives inside the frame on the left,
 * profile info on the right. Everything amber-tinted.
 */

import chalk from "chalk";
import open from "open";
import https from "node:https";
import readline from "node:readline";
import { createRequire } from "node:module";
import { USERNAME, AVATAR_WIDTH, AVATAR_HEIGHT } from "./config.js";
import avatar from "./avatar.js";

const { version } = createRequire(import.meta.url)("./package.json");

// ─────────────────────────────────────────────────────────────
// config
// ─────────────────────────────────────────────────────────────
const config = {
  username: USERNAME,
  calendar: null,
};

const c = {
  frame: chalk.hex("#fbbf24"),
  bright: chalk.hex("#fcd34d"),
  text: chalk.hex("#fbbf24"),
  dim: chalk.hex("#92400e"),
  live: chalk.hex("#34d399"),
  warm: chalk.hex("#fbbf24"),
  faint: chalk.hex("#78350f"),
};

// box widened to 80 chars to host the avatar inside
const WIDTH = 80;
const PAD = "  ";

// layout columns inside the card
const LEFT_PAD = 3;                // space from left frame to avatar
const COL_GAP = 3;                 // gap between avatar and right column
const AVATAR_COL = AVATAR_WIDTH;   // 23
const RIGHT_COL = WIDTH - 2 - LEFT_PAD - AVATAR_COL - COL_GAP - 2; // remaining

// ─────────────────────────────────────────────────────────────
// data
// ─────────────────────────────────────────────────────────────
function fetchJSON(path) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: "api.github.com",
        path,
        headers: { "User-Agent": "npx-card" },
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (ch) => (data += ch));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function fetchProfile(username) {
  const [profile, socials, events] = await Promise.all([
    fetchJSON(`/users/${username}`),
    fetchJSON(`/users/${username}/social_accounts`),
    fetchJSON(`/users/${username}/events/public`),
  ]);

  let latest = null;
  if (Array.isArray(events)) {
    const push = events.find((e) => e.type === "PushEvent");
    if (push?.payload?.commits?.length) {
      latest = {
        type: "commit",
        target: push.repo.name,
        detail: push.payload.commits[0].message.split("\n")[0],
        at: new Date(push.created_at),
      };
    } else {
      const star = events.find((e) => e.type === "WatchEvent");
      if (star) {
        latest = { type: "star", target: star.repo.name, detail: null, at: new Date(star.created_at) };
      }
    }
  }

  const social = {};
  if (Array.isArray(socials)) {
    for (const s of socials) social[s.provider] = s.url;
  }
  return { profile: profile || {}, social, latest };
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const plainLen = (s) => stripAnsi(s).length;

function relativeTime(date) {
  if (!date) return "unknown";
  const s = Math.floor((Date.now() - date) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function statusOf(latest) {
  if (!latest) return { label: "OFFLINE", color: c.faint, bar: 1 };
  const hours = (Date.now() - latest.at) / 3.6e6;
  if (hours < 24) return { label: "ON AIR", color: c.live, bar: 10 };
  if (hours < 168) return { label: "ACTIVE", color: c.warm, bar: 6 };
  return { label: "IDLE", color: c.faint, bar: 3 };
}

function monthYear() {
  return new Date()
    .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .toLowerCase();
}

function truncate(str, max) {
  if (!str) return "";
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

// pad string (ANSI-aware) to exact visual width
function padTo(str, width) {
  const len = plainLen(str);
  if (len >= width) return str;
  return str + " ".repeat(width - len);
}

// ─────────────────────────────────────────────────────────────
// box building blocks
// ─────────────────────────────────────────────────────────────
function boxLine(content) {
  const innerWidth = WIDTH - 2;
  const pad = innerWidth - plainLen(content);
  const padding = pad > 0 ? " ".repeat(pad) : "";
  return PAD + c.frame("║") + content + padding + c.frame("║");
}

function boxTop() { return PAD + c.frame("╔" + "═".repeat(WIDTH - 2) + "╗"); }
function boxBottom() { return PAD + c.frame("╚" + "═".repeat(WIDTH - 2) + "╝"); }
function boxDivider() { return PAD + c.frame("╠" + "═".repeat(WIDTH - 2) + "╣"); }

// inner STATUS box, sits inside the right column
function statusBoxTop(width) {
  const labelText = ` ${c.bright("STATUS")} `;
  const remaining = width - 3 - plainLen(labelText);
  return c.dim("┌─") + labelText + c.dim("─".repeat(Math.max(0, remaining))) + c.dim("┐");
}
function statusBoxBottom(width) {
  return c.dim("└" + "─".repeat(width - 2) + "┘");
}
function statusBoxLine(content, width) {
  const inner = width - 4;
  const pad = inner - plainLen(content);
  const padding = pad > 0 ? " ".repeat(pad) : "";
  return c.dim("│ ") + content + padding + c.dim(" │");
}

// ─────────────────────────────────────────────────────────────
// animation primitives
// ─────────────────────────────────────────────────────────────
async function printSlow(line, delay = 14) {
  console.log(line);
  if (process.stdout.isTTY) await sleep(delay);
}

function progressBar(filled, total = 10) {
  const f = Math.max(0, Math.min(total, filled));
  return "▰".repeat(f) + "▱".repeat(total - f);
}

async function bootProgress(label) {
  if (!process.stdout.isTTY) {
    console.log(boxLine(`  ${c.bright(label)}  ${c.live(progressBar(10))}  ${c.text("OK")}`));
    return;
  }
  for (let i = 0; i <= 10; i++) {
    const bar = c.live(progressBar(i));
    const status = i === 10 ? c.text("OK") : c.dim("...");
    const line = `  ${c.bright(label)}  ${bar}  ${status}`;
    process.stdout.write("\r" + boxLine(line));
    await sleep(50);
  }
  process.stdout.write("\n");
}

// ─────────────────────────────────────────────────────────────
// scene: boot screen
// ─────────────────────────────────────────────────────────────
async function bootScreen() {
  console.log("");
  await printSlow(boxTop(), 30);
  await printSlow(boxLine(`  ${c.bright("DIALING IN...")}`), 60);
  await printSlow(boxLine(""), 30);
  await bootProgress("CONNECTING TO GITHUB.COM   ");
  await sleep(120);
  await printSlow(boxLine(""), 20);
  await printSlow(boxBottom(), 20);

  if (process.stdout.isTTY) {
    await sleep(200);
    for (let i = 0; i < 6; i++) {
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);
    }
    readline.moveCursor(process.stdout, 0, -1);
    readline.clearLine(process.stdout, 0);
  }
}

// ─────────────────────────────────────────────────────────────
// build right column — array of lines, exactly AVATAR_HEIGHT entries
// each entry is an ANSI string sized to RIGHT_COL width
// ─────────────────────────────────────────────────────────────
function buildRightColumn(data) {
  const { profile, social, latest } = data;
  const username = profile.login || config.username;
  const name = profile.name || username;
  const bio = (profile.bio || "no bio set").trim();
  const loc = profile.location || "earth";
  const status = statusOf(latest);

  const lines = [];

  // identity rows — fixed label column width, fixed dots
  const LABEL_WIDTH = 9;
  const DOTS = "....";
  const fieldRow = (label, value) => {
    const labelText = label.padEnd(LABEL_WIDTH, " ");
    const labelPart = `${c.dim(">")} ${c.bright(labelText)} ${c.dim(DOTS)} `;
    const valueMax = RIGHT_COL - plainLen(labelPart);
    return labelPart + c.text(truncate(value, valueMax));
  };

  lines.push(fieldRow("NAME", name));
  lines.push(fieldRow("BIO", bio));
  lines.push(fieldRow("LOC", loc));
  lines.push("");

  // status box (occupies 4 lines)
  const statusWidth = RIGHT_COL;
  lines.push(statusBoxTop(statusWidth));

  const bar = status.color(progressBar(status.bar));
  const statusInner = `${bar}  ${status.color(status.label)}`;
  lines.push(statusBoxLine(statusInner, statusWidth));

  const lastSeen = latest
    ? `last commit ${relativeTime(latest.at)}`
    : "no recent activity";
  lines.push(statusBoxLine(c.text(lastSeen), statusWidth));

  if (latest) {
    const repoLine = `${c.dim("→")} ${c.text(truncate(latest.target, statusWidth - 6))}`;
    lines.push(statusBoxLine(repoLine, statusWidth));
  } else {
    lines.push(statusBoxLine("", statusWidth));
  }
  lines.push(statusBoxBottom(statusWidth));

  // link rows
  lines.push("");
  if (profile.html_url) {
    lines.push(fieldRow("GITHUB", "/" + username));
  }

  const twitter = social.twitter || (profile.twitter_username && `https://x.com/${profile.twitter_username}`);
  if (twitter) {
    const handle = twitter.replace(/^https?:\/\/(twitter\.com|x\.com)\//, "/");
    lines.push(fieldRow("X", handle));
  }

  if (profile.blog) {
    const web = profile.blog.replace(/^https?:\/\//, "").replace(/\/$/, "");
    lines.push(fieldRow("WEB", web));
  }

  if (profile.email) {
    lines.push(fieldRow("MAIL", profile.email));
  }

  if (social.linkedin) {
    const ln = social.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "/");
    lines.push(fieldRow("LINKEDIN", ln));
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────
// scene: render card with avatar inside, side-by-side
// ─────────────────────────────────────────────────────────────
async function renderCard(data) {
  const { profile } = data;
  const username = profile.login || config.username;
  const sysName = username.toUpperCase() + ".SYS";

  console.log("");
  await printSlow(boxTop());

  // title bar
  const titleLeft = `  ${c.bright(sysName)}`;
  const titleRight = `${c.faint("v" + version + "  |  " + monthYear())}  `;
  const titleGap = WIDTH - 2 - plainLen(titleLeft) - plainLen(titleRight);
  await printSlow(boxLine(titleLeft + " ".repeat(Math.max(1, titleGap)) + titleRight));

  await printSlow(boxDivider());
  await printSlow(boxLine(""));

  // ─── side-by-side rows ───
  const avatarLines = avatar.split("\n");
  const rightLines = buildRightColumn(data);

  // pad whichever is shorter so we render the same number of rows
  const totalRows = Math.max(avatarLines.length, rightLines.length);

  for (let i = 0; i < totalRows; i++) {
    const avatarPart = avatarLines[i] || " ".repeat(AVATAR_COL);
    const rightPart = rightLines[i] || "";

    // build the inner content of the box line
    const inner =
      " ".repeat(LEFT_PAD) +
      avatarPart +
      " ".repeat(COL_GAP) +
      padTo(rightPart, RIGHT_COL);

    await printSlow(boxLine(inner));
  }

  await printSlow(boxLine(""));
  await printSlow(boxDivider());

  // hotkey footer inside the box
  const actions = buildActions(profile, data.social);
  const keys = actions
    .map((a) => `${c.bright("[")}${c.text.bold(a.key.toUpperCase())}${c.bright("]")}${c.dim(a.label.slice(1))}`)
    .join("  ");
  await printSlow(boxLine("  " + keys));

  await printSlow(boxBottom());
  console.log("");

  return actions;
}

// ─────────────────────────────────────────────────────────────
// actions
// ─────────────────────────────────────────────────────────────
function buildActions(profile, social) {
  const actions = [];
  actions.push({ key: "g", label: "github", url: `https://github.com/${config.username}` });
  if (profile.blog) {
    const url = profile.blog.startsWith("http") ? profile.blog : `https://${profile.blog}`;
    actions.push({ key: "w", label: "web", url });
  }
  if (profile.email) {
    actions.push({ key: "m", label: "mail", url: `mailto:${profile.email}` });
  }
  if (social.twitter || profile.twitter_username) {
    const url = social.twitter || `https://x.com/${profile.twitter_username}`;
    actions.push({ key: "x", label: "x", url });
  }
  if (social.linkedin) {
    actions.push({ key: "l", label: "linkedin", url: social.linkedin });
  }
  if (config.calendar) {
    actions.push({ key: "c", label: "calendar", url: config.calendar });
  }
  actions.push({ key: "q", label: "quit", url: null });
  return actions;
}

// ─────────────────────────────────────────────────────────────
// input
// ─────────────────────────────────────────────────────────────
function waitForKey(actions) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(null);

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKey = (str, key) => {
      if (key && key.ctrl && key.name === "c") {
        cleanup();
        resolve({ key: "q" });
        return;
      }
      const match = actions.find((a) => a.key === str?.toLowerCase());
      if (match) {
        cleanup();
        resolve(match);
      }
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
    };

    process.stdin.on("keypress", onKey);
  });
}

// ─────────────────────────────────────────────────────────────
// outro
// ─────────────────────────────────────────────────────────────
const signOffs = [
  "NO CARRIER",
  "CONNECTION CLOSED",
  "73, DE OPERATOR",
  "GOODBYE.",
  "LOGGED OFF",
];
const signOff = () => signOffs[Math.floor(Math.random() * signOffs.length)];

function outro() {
  console.log(PAD + c.dim("  ") + c.faint("─ " + signOff() + " ─"));
  console.log("");
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────
async function main() {
  const dataPromise = fetchProfile(config.username);

  if (process.stdout.isTTY) {
    await bootScreen();
  }

  const data = await dataPromise;

  if (!data.profile?.login) {
    console.error(chalk.red(`\n${PAD}COULD NOT REACH GITHUB FOR "${config.username}"\n`));
    process.exit(1);
  }

  const actions = await renderCard(data);

  if (process.stdout.isTTY && process.stdin.isTTY) {
    const chosen = await waitForKey(actions);
    if (!chosen || chosen.key === "q") {
      outro();
      return;
    }
    console.log(PAD + c.dim(`  > opening ${chosen.label}...`));
    console.log("");
    outro();
    await open(chosen.url);
  }
}

main().catch((err) => {
  console.error(chalk.red("SYSTEM ERROR:"), err.message);
  process.exit(1);
});
