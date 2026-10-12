
# bugs

This lists the current bugs in this game:

1. [fixed] No Proper Theme Colors (some elements still follows the default theme)
   - Every theme now declares the full token set, hardcoded colors moved to vars.

2. [fixed] no protection on dev mode anyone can use it should be add password or something to protect.
   - Dev mode needs a PIN (default 2468, change it in Settings).

# features (it don't have)

1. [done] Voice chat

2. [done] No Sound effects

3. [done] Needs more category and game modes.

4. [done] need more good animation means on wictory, lose, and etc.

5. [done] needs to be more engajing

6. [done] Points, Ecomony system needed (so accets and etc people can buy)

7. [done] No Avatar making features.

8. [done] no tranfer feature means money/coins, assets transfer features and etc.

9. [done] More polish and good and more like a Mobile App not fancy AI Slop. profesinal and good and premium.

# round 2 fixes

1. [fixed] Header buttons misaligned — top bar is a grid now, status + wallet stay centered.
2. [fixed] Dev mode entry unreliable — long-press fixed (context menu blocked), Alt+D added, lock screen shows the default PIN.
3. [done] Real time sync — host sends a state heartbeat every 3s, guests heal missed phase/timer/roster drops and re-sync after the tab was hidden.

# round 3

1. [done] Custom dropdowns — theme, pack, mode, and gift pickers are own-made themed menus now, no browser select popups. Text/number inputs stay native so mobile keyboards keep working.

# round 4

1. [fixed] Old styles stuck on phones — index.html is no-cache now, CSS/JS load with ?v=4 version URLs cached hard. Bump APP_VERSION in server.js plus the two URLs in index.html on every release.
2. [fixed] Voice chat silent — remote audio container used display:none (mutes streams on mobile), now visually hidden but audible. Host calls new joiners, enabling mic resets stale listen-only calls, incoming calls are tracked (no doubles), and mic errors tell you when HTTPS is the problem.
3. [checked] UI wiring audit — every button/modal/input ID in the HTML is linked in JS, all 4 selects run the custom dropdown.

# round 5 (friend could not join)

1. [fixed] Invite links ignored the code — share sends #CODE but the app never read it. The room code now pre-fills from the link.
2. [fixed] Join gave up after one try — one slow-network hiccup meant failure. Join now retries 3 times with backoff and says exactly what to check.
3. [fixed] Backgrounding killed the room silently — returning to the tab now reconnects (host) or auto-rejoins (guest).

# round 6 — full audit (Oct 2026, 40 items found)

Severity: P0 = kills rooms, P1 = wrong game outcome, P2 = UI/perf annoyance.

P0 networking/stability:
- A1. STUN-only ICE, no TURN — symmetric/carrier NAT joins fail silently.
- A2. Guest rejoin destroys Peer and makes a new ID — ghost duplicate rows.
- A3. No host migration — host tab closed = room dead for guests.
- A4. Late join mid-game forces location.reload() — feels like a crash.
- A5. Missed gameStart strands guests in lobby with no message.
- A6. Join retry uses fixed 2s delay, no cancel, some paths leave button disabled.
- A7. Role -> discuss uses setTimeout(3500) — throttled in background tabs, game stalls.
- A8. JSON.parse on spy_owned / spy_avatar with no try/catch — one bad write = blank app.
- A9. recordVote has no phase guard, allows self-vote.
- A10. Guest timer driven by per-second packets — drops cause jumps (need endsAt).
- A11. voice-state sent twice (broadcast + sendToHost) by guests.

P1 game logic:
- B1. Bots appear in vote modal and can be voted out — wasted round.
- B2. Double-spy win rule counts 1-spy+1-citizen tie as caught, single-spy tie says spy survives.
- B3. Streak not reset when spy escapes and guesses right.
- B4. Coins are localStorage-only, all citizens paid on spy-caught even with wrong vote.
- B5. pickNewRound uses sort(()=>Math.random()-0.5) — biased shuffle.
- B6. No vote change / no abstain — AFK stalls vote until host timer ends.

P2 UI/perf:
- C1. #game height:100dvh + top-bar = page scroll, chat squeezed.
- C2. Duplicate .action-bar rule (4-col dead, 5-col live); hidden guess button shifts layout.
- C3. Custom .dd-list absolute inside overflow-y:auto modal — clipped options.
- C4. Vote modal X closes with no hint; users think they voted.
- C5. renderChat rebuilds all 120 msgs per message + forces scroll to bottom.
- C6. renderPlayers full rebuild on every 3s sync — focus/scroll loss.
- C7. launchConfetti starts overlapping RAF loops, no resize handling.
- C8. FA full CDN (~100KB) for ~40 icons; unminified script.js; blur(6px) heavy on low phones.
- C9. Dev panel rewrites innerHTML every 1s + on every message even when hidden.
- C10. Server missing Vary: Accept-Encoding; no HEAD handling.
- C11. iOS remote voice play() reject has no tap-to-unmute fallback.
- C12. Avatar color injected into style="" with only escapeHtml — needs hex check.
- C13. Status text differs host/guest; gift-btn 36px < 44px target; mode names truncate at 320px.
- C14. Timer ticks only at 10s, no 5-4-3-2-1 countdown, no chat-pop/gift/leave sounds.
- C15. No manifest/SW offline; _headers lacks ?v= immutable rule that vercel.json has.

Sound today: click, join, vote, tick(once), coin, reveal(unused), success, win, lose, error, round.
Missing: chat-pop, leave, count-5..1, vote-each, vote-done, gift-send/receive, guess-open/right/wrong, volume slider, voice-duck.
Avatar today: 8 FA glyphs + 8 colors + frames. Plan: layered SVG builder (seed by id), keep CSS frames, no Three.js for 36px avatars.
Decor verdict: keep CSS blobs + SVG hero + card flip. Three.js optional lazy lobby particles only, default off — full 3D scene costs ~600KB + battery for a chat app.

TS verdict: stay on JS for now. Split script.js into modules, add // @ts-check + JSDoc + tsc --checkJs in CI. Move to TS+Vite only when protocol types pay off (message unions would have caught spyId/spyIds + phase-typo bugs). No React/Next — DOM is too small to justify it.

# round 6 fixes (15 shipped, v6)

1. [fixed] A8 — safe JSON parse for owned/avatar with hex-checked color fallback.
2. [fixed] A1 (partial) — 5 Google STUN servers + optional TURN from localStorage spy_turn (JSON {urls,username,credential}); without TURN, error text says NAT/relay may block.
3. [fixed] A2/A6 (partial) — joinRoom reuses live Peer instead of destroy+new; backoff 1s/2s/4s; cancel via attempt guard; buttons always re-enabled.
4. [fixed] A9 — recordVote needs vote phase, rejects self-vote and unknown ids.
5. [fixed] B1 — vote modal excludes bots; recordVote rejects bot voter/target.
6. [fixed] B2 — spy caught only if every eliminated id is a spy (both modes same rule).
7. [fixed] B3 — any citizen loss resets streak (spy escape + correct guess included).
8. [fixed] B5 — Fisher-Yates shuffle for spy pick.
9. [fixed] C1/C2 — game column uses calc(100dvh - topbar); removed dead 4-col rule; guess button uses visibility placeholder so bar never jumps.
10. [fixed] C4 — closing vote modal mid-vote toasts "Tap Vote to reopen".
11. [fixed] C5 — chat keeps scroll pos, only autoscrolls when already near bottom; remote chat plays pop.
12. [fixed] C6/C9 — renderPlayers skips rebuild when roster JSON unchanged; dev panel skips work when hidden.
13. [fixed] C7 — confetti cancels prior RAF loop, handles resize, scales for DPR.
14. [fixed] C14 (partial) — ticks at 5-4-3-2-1 + go blip; new chat-pop / leave / gift-send / gift-receive / guess-right / guess-wrong synth sounds; softer error tone.
15. [fixed] A11/C10/C12/C13 — guests send voice-state once (host broadcasts once); server adds Vary + HEAD; avatar color hex-validated; status shows CODE + count; gift-btn 44px; lobby picks stack on narrow phones.

# round 7 fixes (16 shipped, v7)

1. [fixed] A4/A5 — join denied mid-game no longer reloads. Guest stays in lobby with "Game in progress — you join next round" and auto-merges on gameStart/nextRound.
2. [fixed] A7 — role phase driven by roleEndsAt timestamp; host heals past-due role on tab return.
3. [fixed] A10 — timer uses endsAt timestamps (phase/timer/sync all carry it); guests render remaining from it, drops no longer jump the clock.
4. [fixed] Join is cancellable — tapping Join mid-flight cancels retries; internal retries no longer self-cancel.
5. [fixed] B6 — votes can be changed (reopen modal, resubmit) plus a Skip option; tally ignores skips.
6. [fixed] B4 — only citizens who actually voted a spy earn coins; wrong votes / skips pay nothing.
7. [fixed] C3 — dropdown lists inside modals pin fixed under the button (open upward when needed) and close on scroll.
8. [fixed] C11 — blocked voice autoplay toasts "Tap anywhere to hear voice"; any tap resumes remote audio.
9. [fixed] Dev PIN stored hashed (legacy plaintext migrated once), ?dev stripped from the URL after use.
10. [fixed] Duplicate names get a " 2"/" 3" suffix on join so votes stay unambiguous.
11. [fixed] Host kick — lobby rows show a remove button (host only); kicked guest gets a reason message.
12. [fixed] Guest disconnect shows "Disconnected — tap Join Room to retry" with a Reconnect-labeled button; ?room= links work besides #CODE.
13. [done] PWA manifest (standalone, portrait, SVG icon) + volume slider in Settings with voice ducking (SFX halve while mic is live).
14. [fixed] Vote-change toast, dashed Skip row style, kick button 44px target.
15. [fixed] joinDenied/welcome reset the joining flag so the Join button never sticks disabled.
16. [done] Dev mode is now full control: Become spy/citizen (host: real reassign pushed to room via devSpy; guest: local spoof), Set location, Spoof spy UI + Unspoof, +500 coins, Unlock all shop, +3 score, Skip timer to 3s, Force results, System message, Kick by name, End game. Guest spoofs are tagged local-only; host cheats broadcast and are tagged CHEAT.

# round 8 — remaining bugs closed + remaining features (v8)

Bugs:
1. [fixed] A1 (done) — TURN relay fields in Settings (URL/username/credential, device-local, validated turn:/turns:), applied on next create/join. No hardcoded secrets in the bundle.
2. [fixed] A3 (graceful) — true host migration is out of reach for a star-topology P2P room (guests hold no mesh to each other), so leaving now closes cleanly: host broadcasts hostLeft, guests keep scores and see "Room Closed — Host Left" instead of a dead screen.
3. [fixed] B4 (by design, noted) — coins stay cosmetic/local (P2P has no authority to mint); payouts now only reward correct votes, spy escapes, and correct guesses.
4. [fixed] C8 (partial) — backdrop blur removed under 480px (biggest mobile GPU cost); FA-subset swap logged as future work, unminified dev file kept for direct hosting.
5. [fixed] C15 (done) — sw.js offline shell (cache-first, versioned spy-v8, old caches purged) registered on http(s) only; _headers can't match ?v= queries on Cloudflare, so immutable-query caching stays Vercel-only by platform limit.

Features:
6. [done] Generated SVG avatars — seeded faces (bg/skin/eyes/mouth/extras: blush, glasses, headband), zero assets, offline-safe. Shuffle + Classic toggle in the builder, fresh users start with a face, lists/votes/scores/final all render it.
7. [done] Lobby chat — pre-game talk box in the host lobby on the same relayed channel (history shared with game chat).
8. [done] Rematch without reload — Back to Lobby resets scores/round/chat for the whole room via toLobby; guests can ask via wantLobby; results End Game button resets correctly per round screen.
9. [done] Role-reveal flip animation + lobby glow/decor polish (second backdrop glow, logo ring).
10. [done] Volume slider + voice ducking shipped in round 7; countdown ticks, gift/guess/chat sounds shipped in rounds 6–7. Sound map now complete for v8 scope.

Left as documented future work (needs server or heavy rework, not P2P-client fixes):
- True host migration / full mesh voice+data (needs SFU or relay server).
- FA CDN subset (~100KB) — replace with inline SVG icon sprite.
- Server-minted coins/scores (needs authority backend).
- _headers ?v= immutable rule (Cloudflare _headers can't match query strings).

# round 9 — Matiks-grade avatars, real music, Duolingo UI (v9)

Avatars (DiceBear pattern: component variants + FNV-1a/Mulberry32 seeded picks):
1. [done] Layered v2 faces — 6 skins, 8 hair, 6 eyes, 4 brows, 6 mouths, 6 gear, 8 backs. Pure renderer: same object, same face, any size.
2. [done] Tabbed builder — Skin/Hair/Eyes/Brows/Mouth/Gear/Back tabs, live full-face thumbnails per option, big preview, Shuffle + Reset, Shop frames kept.
3. [done] Proper storage — versioned spy_avatar_v2 key, throw-safe store helpers (private-mode proof), v1 svgSeed/FA auto-migrated once, old key dropped.

Music (zero assets, lookahead scheduler per Web Audio best practice):
4. [done] Lobby loop — I–V–vi–IV pads + 24-step bass against 32-step melody with alternating pluck phrases (~30s before exact repeat), sine/triangle through lowpass, starts on first gesture only.
5. [done] Win fanfare + lose sting as composed phrases layered over the existing SFX; music stops the second gameplay starts, on finals, and when the tab hides.
6. [done] Lobby music toggle in Settings; volume slider drives SFX + music (music bus at 0.4, ducked with voice).
7. [done] Click blip on every control via one delegated listener; 70ms same-type dedupe kills double-fires with the explicit plays.

Duolingo reference (chunky lip system, pill badges, rounded display type):
8. [done] 3D lip buttons — 4px hard bottom lip on primary/secondary/ghost (auto-shaded per theme via color-mix), depress-to-1px on press, 16px radius, Baloo 2 display face.
9. [done] Chunky icon/action buttons (3px lip + press), 2px card borders, pill wallet chip, pill streak banner with pulsing flame, press states on vote options.
