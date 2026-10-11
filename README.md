# Who is the Spy? — Party Game for 3–8 Friends

Mobile-first, real-time party game. **Pure HTML + CSS + JS** — no backend, no signup. Host on Vercel or Cloudflare Pages free.

## How to play
1. Host taps **Create New Room** and shares the 5-letter code.
2. Friends enter their name + code and tap **Join Room**.
3. Host starts (min. 3 players). Everyone sees the location — except the spy.
4. Discuss in chat → vote → spy can guess the location for +3 → next round or end.

## Fixes in this version
- **Chat actually works** — guest messages relay through host with dedupe IDs, no doubles, no invisible messages.
- **No spy cheating** — host sends each player only what they may know. Spy gets `null` location, guests never receive `spyId` until reveal.
- **Host-authoritative phases** — guests no longer fire `startDiscussion` (was causing double timers + ghost phase broadcasts).
- **Votes can't stall** — bots excluded from quorum, leavers removed from tally, live `x/y voted` progress, vote modal auto-closes on results.
- **PeerJS collisions fixed** — room IDs namespaced (`whos-spy-v1-CODE`), 2 STUN servers, `unavailable-id` auto-retries a fresh code, 12s join timeout.
- **Dev mode fixed** — long-press (700ms) / triple-click / `?dev` / `?debug`, persists, live 1s refresh, in-panel reveal (no `alert`), add/remove bots, force/end vote, copy state, Esc closes.
- **No more `alert()`** — toasts everywhere; clipboard has insecure-context fallback; Web Share API for invites.
- **XSS hardened** — every player name / message escaped before `innerHTML`.

## Polish
- Font Awesome 6.5.1 icons (no emoji buttons), Sora display + Inter body + JetBrains Mono for codes.
- New main menu: hero, pills, labeled inputs, 4-step how-to-play card.
- Game screen: phase pill, low-timer warning, role banner (red spy variant), avatar chips, action bar (Vote / Guess / Sound / Leave), guess search box.
- Results with ranked score rows, trophy, tie handling. Safe-area + `100dvh` + 44px touch targets throughout.

## Dev mode
- Long-press the title (~0.7s), triple-click it, or open with `?dev`.
- Force vote, end vote, reveal spy, add/remove bots, clear chat, copy/log full state.

## Hosting
Upload `index.html`, `styles.css`, `script.js` (+ `vercel.json` / `_headers`) to:
- **Vercel** — import the folder, framework preset: Other, no build needed.
- **Cloudflare Pages** — direct upload or `git push`, build command empty, output `.`.

Notes: host must keep the tab open (star topology). PeerJS cloud signaling is free/shared — for big events run your own PeerServer and point `Peer` at it.
