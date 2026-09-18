// Drives a real in-browser recording with headless Chrome and a FAKE microphone fed from a WAV file:
// start, navigate within the app while recording, check the indicator and tab title persist, stop, wait for the result.
// Usage: node scripts/record-e2e.mjs <base-url> <session-cookie> <speech.wav> <screenshot-dir>
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, cookie, wav, outDir] = process.argv.slice(2);
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ms-rec-"))}`, "--window-size=1440,820", "--hide-scrollbars", "--no-first-run",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const shot = async (name) => writeFileSync(join(outDir, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const u = new URL(base);
  await send("Network.setCookie", { name: "ms_session", value: cookie, domain: u.hostname, path: "/", httpOnly: true, secure: u.protocol === "https:" });
  await send("Page.enable");
  await send("Page.navigate", { url: `${base}/meetings` });
  await sleep(3000);

  console.log("1. click 'Start instant meeting':", await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Start instant meeting')); if (!b) return 'button not found'; b.click(); return 'clicked'; })()`));
  await sleep(4000);
  console.log("2. indicator on /meetings:", await js(`document.querySelector('[role=status]')?.textContent?.replace(/\\s+/g,' ').trim() ?? 'MISSING'`));
  console.log("   meetings list row:", await js(`[...document.querySelectorAll('li')].map(l => l.textContent).find(t => t.includes('Meetscribe is recording'))?.slice(0,60) ?? 'no row yet'`));
  await shot("rec-1-meetings.png");

  console.log("3. navigate inside the app to Ask:", await js(`(() => { const a = document.querySelector('a[href="/ask"]'); a.click(); return 'clicked'; })()`));
  await sleep(2500);
  console.log("   now at:", await js("location.pathname"), "| indicator:", await js(`document.querySelector('[role=status]')?.textContent?.replace(/\\s+/g,' ').trim() ?? 'MISSING'`));
  console.log("   tab title:", await js("document.title"), "| favicon:", await js(`JSON.stringify([...document.querySelectorAll('link[rel~=icon]')].map(l => l.getAttribute('href')))`));
  await shot("rec-2-ask.png");

  await sleep(3000);
  console.log("4. elapsed before stop:", await js(`document.querySelector('[role=status]')?.textContent?.match(/\\d+:\\d\\d/)?.[0]`));
  console.log("   click Stop:", await js(`(() => { const b = [...document.querySelectorAll('[role=status] button')].find(x => x.textContent.includes('Stop')); b.click(); return 'clicked'; })()`));
  await sleep(1500);
  console.log("   indicator while saving:", await js(`document.querySelector('[role=status]')?.textContent?.replace(/\\s+/g,' ').trim() ?? '(gone)'`));
  for (let i = 0; i < 20; i++) { await sleep(1500); if ((await js("location.pathname")).startsWith("/meetings/")) break; }
  console.log("5. redirected to:", await js("location.pathname"), "| tab title restored:", await js("document.title"), "| indicator:", await js(`document.querySelector('[role=status]')?.textContent?.includes('recording') ? 'STILL SHOWN' : 'gone'`));
  console.log("MEETING_ID=" + (await js("location.pathname.split('/')[2]")));
  await sleep(12000);
  await send("Page.reload"); await sleep(3000);
  await shot("rec-3-result.png");
  console.log("6. page after processing:", await js(`document.querySelector('main')?.innerText?.replace(/\\s+/g,' ').slice(0, 260)`));
} finally { chrome.kill(); }
