# Wick Runner — Skyline edition

A browser parkour game on simulated candlestick courses. Static hosting supports practice. The optional Node service adds wallet sign-in, shared boards and server replay verification.

Current scoring is rules v5: long courses and seeded side hazards, with the skill scoring from v4. Auto-run provides pace, not skill chains. Distance earns 2 points/metre, orbs a flat 10 points without combo, and unprompted automatic traversals earn no trick points. Intentional jumps, slides, dashes and grabs enable connected style rewards. Old version 3/4 bests remain stored separately and are not converted into version 5 boards or ghosts.

The result card includes an expandable score breakdown showing distance, banked moves and pickups, time bonus, clean finish, timeframe multiplier and death penalty. The displayed final value is checked against the actual replayed score.

## Run locally

Requires Node 22.13+; built-in SQLite is experimental in Node 22.

```powershell
npm ci
npx playwright install chromium
npm start
```

Open [the local game](http://localhost:8123). With Chrome installed, you can skip the Chromium download:

```powershell
$env:CHROME_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
npm start
```

The default listener is 127.0.0.1. Sessions, tickets, replays and scores are persisted in `data/parkour.sqlite`. Use SQLite backup facilities, or stop the service before copying its database.

## Controls and quick play

Quick Run starts a 900-candle endurance Sprint with auto-run enabled. A/D or left/right arrows steer; S/down brakes; Space jumps (again for a double jump); Shift/C slides or air-dashes. V toggles auto-run. With auto-run disabled, W/S controls forward/back movement. Mouse capture and touch camera movement are opt-in through Free Look in Settings. Auto-run gently recenters an unsteered runner; pickups and Flow no longer change running speed.

Training is 24 candles with simple authored moves and checkpoints every eight candles. Sprint adds rails, swings, springs and visible boost pads, with checkpoints every twelve candles, fixed 1H timing and a 1,035-second par. Campaign and Cup charts have 1,200 candles; Daily has no finish gate. Training remains a short introduction. Timed-input checks clear a Sprint in about 14 minutes; actual player times vary.

Losing window focus pauses the run and clears held controls. Touch controls reset their finger tracking on pause, so a fresh touch works immediately after resuming. Held action buttons show a pressed state; lifting one of multiple fingers does not release a button still held by another finger.

Mobile also offers a held BRAKE button. The HUD shows remaining jumps and whether an air dash is available. Ground advice previews the actual obstacle, warns how long a cracking candle has left, and distinguishes connected steps from gaps. Swing advice identifies forward launch windows; blue landing markers identify boost pads. These are visual aids and do not steer, jump or change scoring for the player.

Results include a movement review: best banked link, clean flips and perfect landings across the run, including retries. This feedback gives no additional XP or score. The finish celebration lasts 1.6 seconds before results, then continues beside the card. Ghost pace is interpolated at the first crossing of your distance, compared against the local best-score run.

## Checks

Pause offers Retry checkpoint once a checkpoint is reached, charging one death and three seconds. It is unavailable in one-life Daily and Cup runs. Results compare score, clear time and deaths against your local best-score run; time comparisons require two completed runs. A practice hint highlights the section with the most falls. Manual checkpoint retries are not counted as falls in that hint, but still count as deaths for scoring and stars.

```powershell
npm test
npm run check:browser
npm run check:service
npm run check:gameplay
```

Browser checks require the game on port 8123 and Chrome installed (or CHROME_PATH set). They check replay parity, Unicode links, desktop/mobile layout, pause/resume, modal Escape and browser errors; screenshots go to `artifacts/`.

The gameplay check tests tap/hold jump height, coyote time, buffered jumps, braking, manual controls, automatic low-ledge vaulting and full timed-input clears of training, all three Sprint routes plus the first 250 candles of CP01 with replay parity. It checks movement feedback against replay and keeps retry actions visible on desktop, portrait and landscape result layouts.

The service check starts an isolated server on port 8124 with a temporary database and a generated test wallet. It checks login, real replay acceptance, forged/duplicate rejection, Cup limits, private-file isolation and bounded endless-course retention. No blockchain transaction is sent. Software WebGL checks do not replace a real-device playtest.

## Hosting

Use one persistent Node/container instance behind HTTPS for the complete experience.

| Variable | Default | Purpose |
|---|---|---|
| PORT | 8123 | Listener port |
| HOST | 127.0.0.1 | Set 0.0.0.0 in a container |
| PUBLIC_ORIGIN | http://localhost:8123 | Exact public HTTPS origin for login/POST validation |
| DATA_DIR | ./data | Persistent SQLite directory |
| CHROME_PATH | Playwright Chromium | Optional browser executable |

```text
docker build -t wick-runner .
docker run --init -p 8123:8123 -v parkour-data:/app/data -e PUBLIC_ORIGIN=https://your-domain.example wick-runner
```

Terminate HTTPS at your proxy. The app does not trust forwarded headers for authentication. Rate limits use the direct peer IP; configure an edge limiter when a proxy handles many users. Use a single replica until storage and limits are deliberately migrated to shared infrastructure.

The verifier runs the actual game in a fresh browser context and needs Chromium/WebGL. It is not suited to short-lived serverless functions. It verifies one run at a time and returns a retryable 503 while busy. Scale after measuring demand; never bypass verification to handle load.

For static-only hosting, publish `index.html`, `game.mjs` and `game-core.mjs`. `.vercelignore` excludes backend files and data. Practice still works and the UI explains why shared boards are unavailable. Never publish data, environment files or the working directory wholesale.

## Trust boundaries

- XP/SP and unlocks remain local and must not determine payout eligibility.
- Login signs a nonce-based, domain-bound message; no token approval or transaction. Cookies are HTTP-only, SameSite=Strict and Secure on HTTPS.
- Tickets precede play. The service limits Cup starts, checks elapsed time/course and replays bounded inputs before recording a score.
- Replay proves a possible run, not human play or unique identity. Bots and multiple wallets require review before valuable prizes.
- This service is implemented and tested, not independently audited. No payout, swap, token or payment contract is included.
- Arena publisher checks still need a real launchpad-token integration test once an official token exists. Badges are not endorsements.
- Rules v3 have separate board keys. Old local boards/ghosts are left intact but do not compete under changed scoring. XP/unlocks remain.

See [the economy](ECONOMY.md) and [product/growth suggestions in Persian](STRATEGY.fa.md). Paid plans and holder snapshots remain proposals. Sprint is implemented. No public deployment or hosting account has been created.

Movement feedback distinguishes linked moves from the actual score multiplier, highlights clean landings and banked combos, and shows 100% and all candles on a completed course. Coaching and action cues share space without overlapping. Run XP has a course-progress ceiling so a first Sprint does not unlock every character.

## Sprint routes and landing guidance

Sprint now has three fixed routes selected under Choose your line: Flowline (balanced), Airline (spring/climb focus) and After Hours (more parkour connections). Each has a separate board, stars and ghost; retrying keeps the layout unchanged. Flowline preserves the original v3 Sprint board. Route choice is included in ranked tickets and replays; legacy Sprint logs without a route select Flowline.

The landing arc is a visual estimate under the current input, not an automatic jump or a guarantee. It accounts for the jump-release cut, airborne steering, known live-platform motion and already-cracking platforms. Green/cyan indicates a central landing, amber an edge and red a red candle; the next-move text also describes the landing so color is not the only cue.

Post-run goals use the actual result: a reachable candle target, fewer deaths, seconds needed to beat par or the point gap to the previous local best. A clean Sprint clear links directly to the next named route.

## Side hazards

Laser gates block part of a rooftop up to seven metres high: steer into the marked left or right safe lane. Mine strips can be avoided sideways or jumped over. Hazards start after the opening section, only on stable green platforms, away from checkpoints and at least eight candles after boost pads/springs and four after feature gaps. A 22-metre preview tells the player which side is safe. Placement is seeded and replayed identically. Old scenery is discarded while the latest checkpoint and its approach remain available for respawn.

New community arenas offer 600/900/1,200 candles. Older short arena links retain their signed configuration but play at least 600 candles under rules v5. The input recording limit remains 30 minutes; courses are long, not literally infinite except Daily. Full automated completion of every 1,200-candle campaign has not been established; the regression check covers the first 250 candles of CP01 and full completions of all three 900-candle Sprints.
