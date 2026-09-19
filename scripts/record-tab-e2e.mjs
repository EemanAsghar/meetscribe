// Drives "Record a meeting tab" in headless Chrome: a second tab plays speech, Chrome auto-selects it in the
// share picker, and a TRUSTED click starts the capture (getDisplayMedia refuses scripted clicks).
// Usage: node scripts/record-tab-e2e.mjs <base-url> <session-cookie> <call-tab-url> <tab-title> <seconds>
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [base, cookie, callUrl, tabTitle, seconds = "30"] = process.argv.slice(2);
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ms-tab-"))}`, "--window-size=1440,820", "--no-first-run",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--auto-select-tab-capture-source-by-title=${tabTitle}`, "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(wsUrl) { return new Promise((resolve) => { const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } }; ws.onopen = () => resolve((method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); })); }); }
try {
  let pages; for (let i = 0; i < 50 && !pages?.length; i++) { await sleep(200); try { pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page"); } catch {} }
  const call = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(callUrl)}`, { method: "PUT" })).json();
  await sleep(2500);
  const send = await connect(pages[0].webSocketDebuggerUrl);
  const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const u = new URL(base);
  await send("Network.setCookie", { name: "ms_session", value: cookie, domain: u.hostname, path: "/", httpOnly: true });
  await send("Page.enable"); await send("Page.bringToFront");
  await send("Page.navigate", { url: `${base}/meetings/new?mode=record` }); await sleep(3500);
  const box = await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Record a meeting tab')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  console.log("1. button found:", Boolean(box), "| call tab:", call.title || call.url);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(5000);
  console.log("2. indicator:", await js(`document.querySelector('[role=status]')?.textContent?.replace(/\\s+/g,' ').trim() ?? 'MISSING'`), "| error shown:", await js(`document.querySelector('[role=alert]')?.textContent?.trim().slice(0,160) ?? 'none'`));
  await sleep(Number(seconds) * 1000);
  console.log("3. elapsed:", await js(`document.querySelector('[role=status]')?.textContent?.match(/\\d+:\\d\\d/)?.[0] ?? '-'`));
  await js(`[...document.querySelectorAll('[role=status] button')].find(x => x.textContent.includes('Stop'))?.click()`);
  for (let i = 0; i < 25; i++) { await sleep(1500); if (/^\/meetings\/[0-9a-f-]{36}/.test(await js("location.pathname"))) break; }
  console.log("4. redirected to:", await js("location.pathname"));
  console.log("MEETING_ID=" + (await js("location.pathname.split('/')[2]")));
} finally { chrome.kill(); }
