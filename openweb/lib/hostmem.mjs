// Small hosts (Render's free plan: 512 MB) cannot open a browser: Chromium for recording a video, or for searching YouTube without
// an API key, takes more memory than the plan has, and the whole server is killed mid-request (the page shows HTTP 502 and the log
// shows "instance restarted"). On such a host the heavy steps are refused with a clear message — or skipped, when the rest of the
// result is still useful — instead of crashing the server. LITE_MODE=1 forces this on, LITE_MODE=0 forces it off.
import fs from "node:fs";

/** The memory limit of this container in MB (cgroup v2 or v1), or null when there is none or it cannot be read. */
export function memoryLimitMB(read = (/** @type {string} */ f) => fs.readFileSync(f, "utf8")) {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try { const v = read(f).trim(); if (v && v !== "max" && /^\d+$/.test(v) && +v < 2 ** 50) return Math.round(+v / 1048576); } catch { /* not this layout */ }
  }
  return null;
}

/** True on a host with too little memory for a browser (under 1.2 GB), or when LITE_MODE=1. */
export function isLowMemory(env = process.env, read = undefined) {
  if (env.LITE_MODE === "1") return true;
  if (env.LITE_MODE === "0") return false;
  const mb = memoryLimitMB(read);
  return mb != null && mb < 1200;
}

export const LOW_MEMORY_WHY = "This server has too little memory to open a browser (it would restart). Run the app on your PC, or move it to a plan with 2 GB of memory or more.";
