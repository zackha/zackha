// ─────────────────────────────────────────────────────────────
// inline image protocols — real pixels where the terminal allows
// ─────────────────────────────────────────────────────────────

export function detectGraphics(env = process.env) {
  if (env.TMUX || env.STY || env.ZACKHA_BLOCKS) return null;
  if (env.TERM === "xterm-kitty" || env.KITTY_WINDOW_ID) return "kitty";
  if (env.TERM_PROGRAM === "ghostty" || env.TERM === "xterm-ghostty") return "kitty";
  if (env.TERM_PROGRAM === "iTerm.app" || env.LC_TERMINAL === "iTerm2") return "iterm";
  if (env.TERM_PROGRAM === "WezTerm") return "iterm";
  return null;
}

// draws the image at the current cursor position, stretched to cols×rows
// cells, without moving the cursor or asking the terminal to reply
export function placeImage(proto, b64, cols, rows) {
  if (proto === "kitty") {
    const CHUNK = 4096;
    let out = "";
    for (let i = 0; i < b64.length; i += CHUNK) {
      const more = i + CHUNK < b64.length ? 1 : 0;
      const head = i === 0 ? `a=T,f=100,q=2,C=1,c=${cols},r=${rows},m=${more}` : `m=${more},q=2`;
      out += `\x1b_G${head};${b64.slice(i, i + CHUNK)}\x1b\\`;
    }
    return out;
  }
  const size = Math.floor((b64.length * 3) / 4);
  return `\x1b]1337;File=inline=1;size=${size};width=${cols};height=${rows};preserveAspectRatio=0;doNotMoveCursor=1:${b64}\x07`;
}

export function clearImages(proto) {
  return proto === "kitty" ? "\x1b_Ga=d,d=A,q=2\x1b\\" : "";
}
