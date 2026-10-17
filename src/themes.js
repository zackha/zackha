// ─────────────────────────────────────────────────────────────
// phosphor themes — `ramp` tints the photo (shadow → highlight),
// the rest colors the interface
// ─────────────────────────────────────────────────────────────

import { hex } from "./paint.js";

const RAW = [
  {
    id: "amber",
    label: "AMBER P3",
    ramp: ["#0b0602", "#2a1404", "#552a07", "#8a470c", "#c36a12", "#ec9524", "#ffbf57", "#ffe2a6"],
    bg: "#0a0704", scan: "#0d0905", panel: "#120c06",
    border: "#6e4515", fg: "#f2a33a", bright: "#ffd88f", dim: "#a26a28", faint: "#4f3314",
    accent: "#ff6f3c", live: "#ffcf6b",
  },
  {
    id: "green",
    label: "GREEN P1",
    ramp: ["#010702", "#03200c", "#073f19", "#0e692b", "#1a9c43", "#34d165", "#80ffa0", "#dcffe6"],
    bg: "#030804", scan: "#050b06", panel: "#06100a",
    border: "#1d5c33", fg: "#3ee27c", bright: "#b0ffca", dim: "#2a8c50", faint: "#133d24",
    accent: "#d6ff5c", live: "#9dff7a",
  },
  {
    id: "ice",
    label: "ICE P4",
    ramp: ["#01050a", "#041628", "#0a2f4e", "#114e7a", "#1b78ad", "#3eacdd", "#8fdaff", "#e2f6ff"],
    bg: "#04070c", scan: "#060a10", panel: "#080e16",
    border: "#1f4c6e", fg: "#5ec8ff", bright: "#c8edff", dim: "#3480ad", faint: "#16354d",
    accent: "#ff6ad5", live: "#7dffe6",
  },
  {
    id: "paper",
    label: "PAPER WHITE",
    ramp: ["#050505", "#1a1a19", "#363634", "#5a5a57", "#83837f", "#adada8", "#d6d6d0", "#f7f7f2"],
    bg: "#080808", scan: "#0b0b0b", panel: "#101010",
    border: "#4a4a48", fg: "#dcdcd6", bright: "#ffffff", dim: "#8f8f8a", faint: "#3a3a38",
    accent: "#ff5f57", live: "#7dff9b",
  },
];

export const THEMES = RAW.map((t) => {
  const out = { ...t };
  for (const [k, v] of Object.entries(t)) {
    if (k === "ramp") out.ramp = v.map(hex);
    else if (typeof v === "string" && v.startsWith("#")) out[k] = hex(v);
  }
  return out;
});

// same palette, but leaves the terminal's own background alone —
// used for the card printed into scrollback
export const transparent = (t) => ({ ...t, bg: null, scan: null, panel: null });
