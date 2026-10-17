// ─────────────────────────────────────────────────────────────
// GitHub — profile, socials and the public activity feed
// ─────────────────────────────────────────────────────────────

import https from "node:https";

function fetchText(hostname, path, accept) {
  return new Promise((resolve) => {
    const req = https.get(
      { hostname, path, headers: { "User-Agent": "npx-zackha", Accept: accept }, timeout: 4000 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (ch) => (data += ch));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function get(path) {
  const text = await fetchText("api.github.com", path, "application/vnd.github+json");
  try { return text && JSON.parse(text); } catch { return null; }
}

// the public contribution graph — plain github.com HTML, so it doesn't
// spend the 60-requests-an-hour API quota
async function calendar(username) {
  const html = await fetchText("github.com", `/users/${username}/contributions`, "text/html");
  if (!html) return null;
  const days = [];
  for (const [tag] of html.matchAll(/<td[^>]*data-date="[^"]+"[^>]*>/g)) {
    const date = tag.match(/data-date="(\d{4}-\d{2}-\d{2})"/)?.[1];
    const level = tag.match(/data-level="(\d)"/)?.[1];
    if (date && level) days.push({ date, level: +level });
  }
  if (!days.length) return null;
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = html.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/)?.[1];
  return { days, total: total ? +total.replace(/,/g, "") : null };
}

const KINDS = {
  PushEvent: ["▲", "push"],
  WatchEvent: ["★", "star"],
  PullRequestEvent: ["◆", "pr"],
  PullRequestReviewEvent: ["◆", "review"],
  PullRequestReviewCommentEvent: ["»", "review"],
  IssuesEvent: ["●", "issue"],
  IssueCommentEvent: ["»", "comment"],
  CreateEvent: ["+", "create"],
  DeleteEvent: ["-", "delete"],
  ForkEvent: ["◇", "fork"],
  ReleaseEvent: ["■", "release"],
  PublicEvent: ["◎", "publish"],
};

function toActivity(e) {
  const [icon, verb] = KINDS[e.type] || ["·", e.type.replace(/Event$/, "").toLowerCase()];
  return { icon, verb, repo: e.repo?.name || "", at: new Date(e.created_at) };
}

export async function loadProfile(username, fallback) {
  const [p, socials, events, cal] = await Promise.all([
    get(`/users/${username}`),
    get(`/users/${username}/social_accounts`),
    get(`/users/${username}/events/public?per_page=20`),
    calendar(username),
  ]);

  const social = {};
  if (Array.isArray(socials)) for (const s of socials) social[s.provider] = s.url;

  const online = Boolean(p?.login);
  const src = online ? p : {};

  return {
    online,
    login: src.login || username,
    name: src.name || fallback.name || username,
    bio: (src.bio || fallback.bio || "").normalize("NFKC").trim(),
    location: src.location || fallback.location || "",
    blog: src.blog || fallback.blog || "",
    email: src.email || fallback.email || "",
    twitter: social.twitter || (src.twitter_username && `https://x.com/${src.twitter_username}`) || fallback.twitter || "",
    linkedin: social.linkedin || fallback.linkedin || "",
    repos: src.public_repos,
    followers: src.followers,
    since: src.created_at ? new Date(src.created_at).getFullYear() : null,
    activity: Array.isArray(events) ? events.map(toActivity) : [],
    calendar: cal,
  };
}
