// Verifies the floating (Document Picture-in-Picture) recording indicator in a VISIBLE Chrome window, because
// headless Chrome does not have the API. Starts a recording with a trusted click, checks the floating window,
// presses Stop INSIDE it, and waits for the redirect. Usage: node scripts/floating-indicator-e2e.mjs <base> <cookie>
import { spawn } from "node:child_process"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const [base, cookie] = process.argv.slice(2);
const port = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ms-pip-"))}`, "--no-first-run", "--no-default-browser-check", "--window-size=1300,800", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let t; for (let i = 0; i < 60 && !t; i++) { await sleep(250); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page"); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); let id = 0; const p = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { p.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return r.result?.value ?? r.exceptionDetails?.exception?.description?.slice(0, 140); };
  const u = new URL(base);
  await send("Network.setCookie", { name: "ms_session", value: cookie, domain: u.hostname, path: "/", httpOnly: true });
  await send("Page.enable"); await send("Page.navigate", { url: `${base}/meetings` }); await sleep(3500);
  const box = await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Start instant meeting')); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(4500);
  console.log("1. indicator in the app:        ", await js(`document.querySelector('[role=status]')?.textContent?.replace(/\\s+/g,' ').trim() ?? 'MISSING'`));
  console.log("2. floating window open:        ", await js(`Boolean(documentPictureInPicture.window)`), "| size:", await js(`documentPictureInPicture.window ? documentPictureInPicture.window.innerWidth + 'x' + documentPictureInPicture.window.innerHeight : '-'`));
  console.log("3. what the floating window says:", await js(`documentPictureInPicture.window?.document.body.innerText.replace(/\\s+/g,' ').trim() ?? '-'`));
  console.log("4. it is styled (pill background):", await js(`(() => { const w = documentPictureInPicture.window; const el = w?.document.body.firstElementChild; return el ? w.getComputedStyle(el).backgroundColor + ' / radius ' + w.getComputedStyle(el).borderRadius : '-'; })()`));
  console.log("5. 'float' button hidden while floating:", await js(`!document.querySelector('[aria-label="Float this indicator over other tabs"]')`));
  await sleep(2500);
  const timerBefore = await js(`documentPictureInPicture.window?.document.body.innerText.match(/\\d+:\\d\\d/)?.[0]`); await sleep(2200);
  console.log("6. timer ticks inside it:       ", timerBefore, "->", await js(`documentPictureInPicture.window?.document.body.innerText.match(/\\d+:\\d\\d/)?.[0]`));
  console.log("7. press Stop INSIDE the floating window:", await js(`(() => { const b = [...documentPictureInPicture.window.document.querySelectorAll('button')].find(x => x.textContent.includes('Stop')); if (!b) return 'no stop button'; b.click(); return 'clicked'; })()`));
  for (let i = 0; i < 25; i++) { await sleep(1200); if (/^\/meetings\/[0-9a-f-]{36}/.test(await js("location.pathname"))) break; }
  console.log("8. app redirected to:           ", await js("location.pathname"), "| floating window closed:", await js(`!documentPictureInPicture.window`), "| app indicator gone:", await js(`!document.querySelector('[role=status]')?.textContent?.includes('recording')`));
  console.log("MEETING_ID=" + (await js("location.pathname.split('/')[2]")));
} catch (e) { console.log("test failed:", e.message); } finally { chrome.kill(); }
