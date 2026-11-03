# Wick Runner — economy and product rules v5

Updated 31 October 2026. Implemented rules and future business proposals are separated below. TOKEN.address and TOKEN.page remain empty: no token or payout programme is active.

## Product first

The product loop is learn a move → clear a district → improve your line → race a ghost → return for a daily course. Communities publish branded courses without commissioning a whole game. Player retention and repeat organizers should determine the business, not speculative token demand.

## Implemented progression

| Layer | Rules | Purpose |
|---|---|---|
| Run score | 2 points/metre + banked intentional style + finish bonuses, multiplied by timeframe and reduced by deaths | Compare skill on the same course |
| XP | Run score ÷ 40, capped at 4 × candles cleared + 80 for a finish, rounded; plus missions; optional holder boost on run XP only | Permanent character unlocks |
| Season Points | Run score ÷ 100, rounded, plus missions; 1,500/day for everyone | Weekly cosmetic progression |
| Tiers | Bronze 0; Silver 1,000; Gold 3,000; Platinum 6,000; Diamond 8,000 | Persistent cosmetic trails |
| Stars | Clear; clear under par; clear under par without deaths | Mastery goals |
| Ghost | Timed movement samples from your local best | Practice against yourself |

Points cannot be bought, transferred or exchanged for tokens. Local XP/SP are not verified and must never determine financial allocations. All characters use identical physics. Diamond was lowered from 10,000 to 8,000 so near-perfect daily attendance is not required. Holder boosts no longer affect SP or its cap.

A trick awards points at most three times per candle until a pre-checkpoint restart resets style, or across a continuing checkpoint run. Runs are capped at 30 minutes. Each death adds 3 seconds; before the first checkpoint distance/style reset while elapsed time and death count persist.

Version 4 separates its boards, stars and ghosts from version 3; old stored scores are not converted. Auto-run is a control aid. Unprompted vaults, climbs, drops, spring launches and rail rides do not earn trick points or create combos. A consumed jump, slide, dash, rail hop or deliberate grab commits a skill action; its connected airborne movement and landing can earn style until the next grounded step. Orbs award a flat 10 points, with no combo or Flow contribution, down from 100 multiplied points. Distance awards 2 points/metre, down from 10. Manual and auto-run controls use the same scoring rules, and verification replays the same intent state from the input log. Existing daily missions still count observed moves, such as riding a spring, regardless of whether that move earned style; their once-per-day cosmetic reward is separate from run scoring.

## Practice and ranked play

Practice is free and needs no wallet, including unlimited practice Cup retries. Local bests and ghosts are labelled local.

Retry checkpoint from Pause has the same score penalty as dying and adds three seconds. It is recorded in the input log and replayed by the verifier; it is disabled for Daily and Cup. Result comparisons use the local highest-score run, not the fastest-ever run. Section practice hints remain local feedback and award no points.

The optional Node service implements domain-bound wallet login with a nonce and expiry, one-use challenges and HTTP-only cookies. A ranked ticket is issued before play. Cup tickets consume one of three ranked starts per wallet per ISO week, including abandoned starts. The service validates bounded input logs, ticket identity, course/version, date, campaign end and elapsed time, then replays the actual game in a fresh trusted browser before storing a score. Each wallet has one best entry per shared board. SQLite persists attempts, scores and replays.

A wallet is an account boundary, not proof of a unique human. Replay proves that inputs can produce a score, not that a human played. Valuable competitions still need published rules, bot/sybil review, monitored hosting, backups and independent service review. No payouts, claim contracts or payment contracts are implemented.

## Holder utility

The existing proposed 10k / 100k / 1M WRUN tiers grant +10 / 20 / 30% cosmetic run XP only. A fresh balance read is required. Account changes, expiry and read failures remove the cached boost. No score, SP, ranked entry limit or movement advantage is granted.

Future holder features should be cosmetic: badges, colorways, frames and community publishing tools. These are proposals. Benefits based on sustained ownership require snapshots, not one-time balance checks.

## Arena identity and verification

All sanitized campaign fields and the publisher separate boards. Changes to token, rules, end date or publisher create a different board; a signature alone does not. Bounded Unicode links carry the full configuration.

Verification checks the signed campaign payload, token creator/creation-transaction sender or current owner, and the proposed WRUN holding threshold. The badge therefore means a token publisher/controller was checked, not an identity audit, endorsement or proof of prize funding. The actual launchpad/factory flow must still be tested once a real official token exists. Ownership and balances may change after a check. Expired arenas remain available for practice, but ranked starts and submissions are rejected.

## Proposed revenue model

| Offer | Player cost | Customer | Basis |
|---|---|---|---|
| Core game and Daily | Free | Players | Retention and discovery |
| Arena beta | Free | Small communities | Validate demand |
| Hosted campaign | Free for players | Organizer | Fixed service fee for a defined duration |
| Cosmetic pack | Optional | Player or sponsor | Art and personalization, no score advantage |
| Sponsored district | Free for players | Organizer | Clearly disclosed sponsorship |

Paid offers are not implemented. Interview organizers and validate willingness to pay before setting prices. WRUN could later be an optional payment route after a reviewed integration; buying tokens should not be necessary to learn or compete.

Budget development against reliable service revenue. Publish treasury inflows, actual costs and spending. Do not promise development funding, burns or distributions based on uncertain trading taxes.

## Launch settings remain uncommitted

Supply, allocation, creator purchases, taxes, graduation conditions and distributions must be checked against the actual launch configuration and published before launch. Previous numerical platform assumptions are not verified commitments. The buy button stays hidden until both the official address and launch URL pass validation.

Any future distribution needs a fixed funded budget, objective rules, a review process, a dispute window and an independently reviewed distribution mechanism. There is no points-to-token exchange rate, guaranteed allocation or promised return.

## Success measures

Track training completion, first district completion, next-day return, weekly returning players, runs per returning player, ranked participation and repeat organizers. Define the baseline and observation window before tuning progression. For holder conversion, use connected holders who play ÷ connected players, within a stated window; players ÷ holders is not a conversion rate.

## References

- Robinhood Chain network settings: https://docs.robinhood.com/chain/add-network-to-wallet/ — this game remains on testnet 46630.
- EIP-4361: https://eips.ethereum.org/EIPS/eip-4361 — domain, nonce, issuance and expiration form part of login verification.

All chart data is simulated. Official launch settings remain the source of truth for platform-specific terms.

## Movement update — rules v3

Training is a 24-candle authored introduction; Sprint is an immediately available 60-candle course. Auto-run, braking and recenter assistance happen before input recording, so server replay consumes the actual resulting inputs. Pickups and Flow award points without surprise speed changes. Only visible boost pads and deliberate movement actions accelerate the runner. Checkpoints are every 8 candles in training, 12 in Sprint, and 25 in campaign charts (on the next safe candle). Sprint par is 75 seconds. Version 3 boards are separate from previous movement rules.

Run XP now has a progress-based ceiling: a clean 24-candle training clear awards at most 176 base XP and a 60-candle Sprint at most 320, before missions or a holder boost. This keeps the new high style scores from unlocking the whole character roster in one minute. Scores and SP are unchanged.


The three Sprint routes (Flowline, Airline, After Hours) are all free and have separate records. They use distinct fixed seeds and route-tagged board IDs. They share the same movement rules, XP ceiling and 1H timeframe; switching routes does not change competitive perks or require tokens.

## Version 5 endurance courses — 1 November 2026

Main campaign and Cup courses are 1,200 candles; Sprint routes are 900. Training stays 24 candles, Daily stays endless, and new arenas offer 600/900/1,200 candles. Version 5 boards and ghosts are separate from v4 because route length, hazards and par targets changed. Sprint par is 1.15 seconds/candle; other non-training courses use 1.5 seconds/candle. Earlier short-course descriptions above are historical. Seeded side gates and mines cause an ordinary death, with the existing checkpoint or one-life rules; they award no new currency or score. The run input cap remains 30 minutes.
