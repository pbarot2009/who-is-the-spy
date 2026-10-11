
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
