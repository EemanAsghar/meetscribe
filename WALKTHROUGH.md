# Walkthrough script

A recording plan for a 5 to 6 minute video. Times are targets. Lines in quotes are suggested narration; everything else is what to do on screen.

**Before recording**
- Use Chrome, signed out, window about 1440 wide. Close other tabs so the "● REC" tab title is visible later.
- Allow microphone access for the site once beforehand, so no permission dialog appears mid-take.
- Open https://meetscribe-three.vercel.app and check the meetings list looks clean.
- Ask one throwaway question first. It warms the functions, so the on-camera answer is fast.
- Click through the Share dialog once. It was tested through its API and the pages it produces, not by hand.
- If an AI call fails on camera ("models are busy"), say so and click Try again. It is a free-tier limit and already disclosed in the README.

## 0:00 Opening (20 s)

Login page.

> "This is Meetscribe, a rebuild of Fathom, the AI meeting notetaker. I used Fathom first and found three things I thought I could do better. Those three are what I built hardest. Everything runs on free tiers."

Click **Continue as demo user**.

## 0:20 The workspace (25 s)

Meetings list.

> "Seven meetings from one fictional company over three weeks, plus one real recorded meeting from a public research corpus. Each row shows how it came in, who was there, and what state it's in."

Type `pricing` in the filter to show it searching summaries, then clear it.

## 0:45 Ask, the feature I wanted to beat (80 s)

Press **⌘K**, type `How did the launch date change, and why?`, Enter.

> "Fathom's cross-meeting chat was the best thing in it, so it's where I tried hardest to go further."

While it streams:

> "It searched every meeting with two methods at once, meaning and keywords, and it's capped per meeting so one long call can't crowd out the rest."

When done, point at the three dates:

> "October 6, then the 20th, then the 27th, in order, each with the meeting it came from and the actual reason."

Hover a citation chip:

> "Every claim has a citation. Hover for the exact quote."

Click it:

> "Click, and I'm on that exact line of that meeting. The server checks every citation before showing the answer. One that points at nothing gets removed."

Back to Ask. Type `What is the capital of France?`

> "And if my meetings don't contain the answer, it says so, in under a second, without calling a model at all. It doesn't guess."

Point at the footer line under the answer.

## 2:05 Notes that change the summary (70 s)

Open **Remote Control Project Kick Off**.

> "This one is a real recorded meeting: eighteen minutes, four people, messy speech. In Fathom I corrected something in the Scratchpad, regenerated, and the summary ignored me."

**Scratchpad** tab: show the note saying the price target is 30 euros, not 25.

**Summary** tab: point at the 30 euros bullet with the violet **From your notes** badge, then click its timestamp.

> "The transcript says twenty five. The summary says thirty, tells me that came from my notes, and still links to where twenty five was said. My notes win."

Optional, if time: add a line to the Scratchpad, show the **"Your notes changed"** banner, click **Regenerate**.

Switch the **template** dropdown to Standup or Enhanced.

> "Same transcript, different structure. Ones I've already generated switch instantly."

## 3:15 Action items and sharing (40 s)

**Action items** tab: tick one, reassign one, add one by hand.

> "Extracted items link back to the moment they were agreed. Ones I add myself are never touched when the summary regenerates."

Click **Share**, turn it on, **Copy link**, open it in a private window.

> "Same summary, same stored row, rendered by the same component, so the two can't drift. No login. My private notes never appear, and neither does the recording. Reset link kills the old URL."

## 3:55 No silent recording (60 s)

Back in the app. Sidebar: click **Simulate a calendar meeting in 2 min**.

> "Fathom shows a branded prompt for calendar meetings. But when I started an instant meeting, it recorded with no visible branding at all. I couldn't tell what was capturing me."

The prompt appears bottom right. Click **Join & capture audio**.

> "Here, scheduled or instant, it's the same path and the same indicator."

Point at the pill at the top, then the browser tab:

> "On every page, in the tab title, in the favicon. There is no way to record without it."

Navigate to Ask and back while it records. Say two or three sentences with a name and a task in them, for example: *"Quick note: Sam will send the contract to legal by Tuesday, and I'll book the room."* Click **Stop**.

> "It uploads, transcribes with Whisper, and runs the same pipeline."

Show the resulting meeting. On the **Transcript** tab click a line's time to play from there.

## 4:55 What's faked, said plainly (35 s)

> "What isn't real: no bot joins Zoom or Meet. Recording, upload and paste stand in for it. Calendar sync is that simulate button. Whisper can't tell speakers apart, so recordings show one speaker. And on free tiers the best model allows twenty requests a day, so these demo summaries were written by a faster, weaker one. The README says exactly which, and what it got wrong when I tested it."

## 5:30 Close (20 s)

Scroll `SPEC.md`'s changelog in GitHub.

> "Everything I measured, every dead end and every decision I reversed is in the spec's changelog, and the full AI conversation that built this is in the repo. Thanks for watching."

---

## If something goes wrong on camera

| Symptom | What it is | What to do |
|---|---|---|
| "The AI models are busy or out of free quota" | Free-tier limit | Say so, press Try again, or move on. Ask runs on a different provider than summaries, so it usually still works. |
| Ask takes 10 s or more | Groq's per-minute token budget; it is waiting for room | Keep talking. It completes. Avoid asking two long questions back to back. |
| Recording ends with "No speech was found" | The microphone picked up silence | Check the selected input device, record again. |
| Summary missing on a meeting | Not generated yet | Summary tab → Generate summary. |
