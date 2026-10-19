// Share Contextual Ad Studio with your team through a free Cloudflare link (no account needed).
// Run share.bat. You choose a password; the app starts on this PC and a public https link is printed.
// Keep this window open while people use the link. The link changes each time you start sharing.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const APP = path.dirname(fileURLToPath(import.meta.url));

function findCloudflared() {
  try { return execSync("where cloudflared", { stdio: ["ignore", "pipe", "ignore"] }).toString().split(/\r?\n/)[0].trim(); } catch {}
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages"), path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links")].filter(Boolean);
  const walk = (d, depth) => {
    if (depth > 3) return null;
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isFile() && /^cloudflared(\.exe)?$/i.test(e.name)) return p;
      if (e.isDirectory() && /cloudflare/i.test(e.name)) { const f = walk(p, depth + 1); if (f) return f; }
    }
    for (const e of entries) if (e.isDirectory() && depth < 1 && /cloudflare/i.test(e.name)) { const f = walk(path.join(d, e.name), depth + 1); if (f) return f; }
    return null;
  };
  for (const r of roots) { const f = walk(r, 0); if (f) return f; }
  return null;
}

const ask = (q) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); r(a.trim()); }); });

const cf = findCloudflared();
if (!cf) { console.log("\ncloudflared was not found. Install it once with:\n  winget install Cloudflare.cloudflared\n"); process.exit(1); }

console.log("\n=== Contextual Ad Studio — share with your team ===\n");
let pw = "";
while (pw.length < 6) pw = await ask("Choose a password for your team (6+ characters): ");

const server = spawn(process.execPath, [path.join(APP, "server.mjs"), "--no-open"], { cwd: APP, env: { ...process.env, APP_PASSWORD: pw }, stdio: ["ignore", "inherit", "inherit"] });
await new Promise((r) => setTimeout(r, 2500));

console.log("\nOpening the share link (takes ~10 seconds)…");
const tunnel = spawn(cf, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4777"], { cwd: APP, stdio: ["ignore", "pipe", "pipe"] });
let shown = false;
const onData = (d) => {
  const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !shown) {
    shown = true;
    fs.writeFileSync(path.join(APP, "share-link.txt"), `${m[0]}\n(password: the one you chose — not saved here)\n`);
    console.log("\n" + "=".repeat(64));
    console.log("  SHARE THIS LINK WITH YOUR TEAM:\n\n    " + m[0]);
    console.log("\n  Sign-in: any username + the password you just chose.");
    console.log("  Keep this window open while people use it. Close it to stop sharing.");
    console.log("=".repeat(64) + "\n");
    spawn("cmd", ["/c", "start", "", m[0]], { detached: true, windowsHide: true });
  }
};
tunnel.stdout.on("data", onData); tunnel.stderr.on("data", onData);
const stop = () => { try { tunnel.kill(); } catch {} try { server.kill(); } catch {} process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
tunnel.on("exit", (c) => { console.log("Share link closed (" + c + ")."); stop(); });
server.on("exit", (c) => { console.log("App stopped (" + c + ")."); stop(); });
