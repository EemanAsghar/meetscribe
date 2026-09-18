// Screenshots a signed-in page with headless Chrome over the DevTools protocol (no puppeteer dependency).
// Usage: node scripts/screenshot.mjs <url> <out.png> [cookieValue] [width] [height]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, cookie, width = "1440", height = "900"] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ms-shot-"))}`,
  `--window-size=${width},${height}`, "--hide-scrollbars", "--no-first-run", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const u = new URL(url);
  if (cookie) await send("Network.setCookie", { name: "ms_session", value: cookie, domain: u.hostname, path: "/", httpOnly: true, secure: u.protocol === "https:" });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(2500);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log("saved", out);
} finally { chrome.kill(); }
