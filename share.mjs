// Share Contextual Ad Studio with your team through a free Cloudflare link (no account needed).
// Run share.bat. You choose a password; anyone using the link signs in with it (you on this PC never need it).
// Keep this window open while people use the link. The link changes each time you start sharing.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const APP = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = path.join(APP, "settings.json");

function findCloudflared() {
  try { return execSync("where cloudflared", { stdio: ["ignore", "pipe", "ignore"] }).toString().split(/\r?\n/)[0].trim(); } catch {}
  for (const p of [path.join(process.env["ProgramFiles(x86)"] || "", "cloudflared", "cloudflared.exe"), path.join(process.env.ProgramFiles || "", "cloudflared", "cloudflared.exe")])
    if (fs.existsSync(p)) return p;
  return null;
}
const ask = (q) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); r(a.trim()); }); });
const up = async () => { try { return (await fetch("http://127.0.0.1:4777/healthz")).ok; } catch { return false; } };

const cf = findCloudflared();
if (!cf) { console.log("\ncloudflared was not found. Install it once with:\n  winget install Cloudflare.cloudflared\n"); process.exit(1); }

console.log("\n=== Contextual Ad Studio — share with your team ===\n");
let pw = process.env.SHARE_PASSWORD || "";
while (pw.length < 6) pw = await ask("Choose a password for your team (6+ characters): ");
const s = (() => { try { return JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { return {}; } })();
s.sharePassword = pw; fs.writeFileSync(SETTINGS, JSON.stringify(s));

// the app is kept running: if it stops (crash or update), it is started again and the share link stays the same
let server = null, stopping = false;
const startApp = () => {
  server = spawn(process.execPath, [path.join(APP, "server.mjs"), "--no-open"], { cwd: APP, env: process.env, stdio: ["ignore", "inherit", "inherit"] });
  server.on("exit", (c) => { if (stopping) return; console.log("App stopped (" + c + ") — restarting…"); setTimeout(startApp, 1500); });
};
if (await up()) console.log("Using the app that's already running on this PC.");
else {
  startApp();
  for (let i = 0; i < 20 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}

// the tunnel is watched too: Cloudflare sometimes drops a free link (sleep, Wi-Fi change) while cloudflared keeps
// running, so a link that stops answering is replaced with a fresh one and share-link.txt is updated
let tunnel = null, link = null, firstLink = true, linkFails = 0, appFails = 0;
const startTunnel = () => {
  console.log("\nOpening the share link (takes ~10 seconds)…");
  link = null; linkFails = 0;
  const t = spawn(cf, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4777"], { cwd: APP, stdio: ["ignore", "pipe", "pipe"] });
  tunnel = t;
  let shown = false;
  const onData = async (d) => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m || shown) return; shown = true;
    fs.writeFileSync(path.join(APP, "share-link.txt"), m[0] + "\n");
    console.log("Link created — waiting for it to go live on the internet (up to a minute)…");
    for (let i = 0; i < 40; i++) {   // the new address takes a moment to resolve
      try { const r = await fetch(m[0] + "/healthz"); if (r.ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (tunnel !== t) return;
    link = m[0];
    console.log("\n" + "=".repeat(66));
    console.log("  SHARE THIS LINK WITH YOUR TEAM:\n\n    " + m[0]);
    console.log("\n  They sign in with any username + the password you just chose.");
    console.log("  Keep this window open while people use it. Close it to stop sharing.");
    console.log("=".repeat(66) + "\n");
    if (firstLink && !process.env.SHARE_NO_OPEN) spawn("cmd", ["/c", "start", "", m[0]], { detached: true, windowsHide: true });
    firstLink = false;
  };
  t.stdout.on("data", onData); t.stderr.on("data", onData);
  t.on("exit", (c) => {
    if (stopping || tunnel !== t) return;
    console.log("Share link closed (" + c + ") — opening a new one…"); setTimeout(startTunnel, 3000);
  });
};
const restartTunnel = (why) => { console.log(why + " — replacing the share link…"); const t = tunnel; tunnel = null; try { t?.kill(); } catch {} startTunnel(); };
startTunnel();
setInterval(async () => {
  if (stopping) return;
  if (await up()) appFails = 0;
  else if (++appFails >= 3 && !server) { appFails = 0; console.log("The app stopped — starting it again…"); startApp(); }
  if (!link) return;
  let ok = false;
  try { ok = (await fetch(link + "/healthz", { signal: AbortSignal.timeout(15000) })).ok; } catch {}
  linkFails = ok ? 0 : linkFails + 1;
  if (linkFails >= 3) restartTunnel("The share link stopped answering");
}, 60000);
const stop = () => { stopping = true; try { tunnel?.kill(); } catch {} try { server?.kill(); } catch {} process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
