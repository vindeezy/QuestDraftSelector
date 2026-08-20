# Project status

Last updated: 2026-08-19

**Deadline: end of August 2026.** The league needs a working draft-order experience.

## What works today

| Piece | State |
|---|---|
| Deterministic sim core | Done. Seeded PRNG, fixed-tick physics, collision, checksums, lint-enforced determinism. |
| Bot Forge (Plinko) | Done. Six boards, one per category, fair, replays byte-identically from a seed. |
| Member colours | Done. Chosen by search, not by eye, after textures compressed the palette to 17.3. **Re-measured 18 August: the worst pair is Spencer/Rob at CIELAB 29.3, not the 34.0 recorded at the time** — that figure is in the notes and cannot be reproduced from `roster.ts`, and nothing in the suite pins it, so it was never load-bearing. Orange against gold is the tight pair and always was. Tommy was lifted to `#3A352E` on 18 August so his chassis sprite is visible; his nearest neighbour is 35.3, above the set's own worst. |
| Bot categories | Done. Six categories, ~74,000 distinct builds, assembled into real stat blocks. |
| Arena | Done. Vehicle movement, directional combat, per-bot armour profiles, seven personalities, launched state, spiral collapse. |
| Hazards | Done. Surfaces, zones, holes, projectiles, buttons, and trapdoors. |
| Abilities | Done. Seven, fired on health thresholds — six activations per life for every build. |
| Event pipeline | Done. Six Forge boards + three battles + scoring + draft order, from one master seed. |
| Recording | Done. `npm run record -- 10` rolls candidates; `--save <seed>` writes the official record. |
| **Arena 1 — The Grinder** | **Done and locked.** Built to spec, measured, balanced. |
| **Arenas 2 and 3** | The Gauntlet and The Crossfire. Playable and recorded against; not rebuilt to spec. |
| Website | **Done end to end.** Landing through Forge, build reveal, three battles, scoreboards, draft order. |
| Official event | **Recorded and deployed**, live at https://vindeezy.github.io/QuestDraftSelector/ as of 18 August. Seed `43000236`, checksum `35d2876d`. Re-recorded twice for roster colour edits — six members on 17 August, then Tommy on 18 August (`#1C1F26` to `#3A352E`, so his chassis sprite is visible). The checksum folds in each member's id, name and colour by design, so a roster edit moves it. Both times the draft order, every point total, all three battle lengths and the tiebreak count were verified identical: on the second the entire `--seed` report differed by exactly one line, the checksum itself, and the saved record by three — colour, checksum, timestamp. |
| Sound | Done. 23 synthesised voices, level-matched by measurement, mixed with per-sound and global voice caps. |
| VFX | Done. Pooled particles, per-weapon/ability/hazard visuals, bot flash, screen shake, reduced-motion support. Smoke Screen and Shockwave have their own emitters — the latter a drawn expanding front rather than a particle ring, because it and the EMP were the same emitter in two tints. |
| Sprites | Done. Five chassis and six weapons, generated then cropped, brightness-normalised and converted by `tools/convert-sprites.py` (12.4 MB of PNG to 471 KB of WebP for the weapons alone). Drawn on the build reveal AND in the arena; `?vectorbots` falls back to the vector machines. |
| Weapon motion | Done. Blades spin, vertical spinners present edge then face, flamethrowers jet, hammers crush — the lift and smash projected for a top-down camera and timed off `nextAttackTick` so the blow lands on the beat. |
| Hazard art | Done. Toothed saws, flame jets sharing the flamethrower's fire, recoiling cannons with lit iron shot, slamming crushers. Button-triggered hazards stay hidden until sprung. |
| Atmosphere | **Done, tiers 1–4a.** Palette rebuilt on charcoal and ember, self-hosted Anton display face, vignette, grain, drifting haze, steel separators folded into `--shadow-lift`, and a reactive glow that lights the room around the arena on eliminations and dims as the floor empties. Grain and reactive light are deliberately kept OFF the arena canvas and the Forge board: the fight surface stays exactly as it was. **Tier 4b — hazard stripes, warning labels, technical markings, rivets — was assessed and cut on 19 August**, not deferred. Everything in the atmosphere layer is *light*; rivets and stripes would have been the first literal ornament, which reads as an industrial theme rather than an industrial place. |
| Landing | **Done, 19 August.** Domain-warped fractal noise drawn as slow smoke on a 2D canvas at ~9,800 pixels and stretched over the viewport, plus a lub-dub pulse on Begin. Reimplemented rather than copied — the 21st.dev reference's shader is behind an authenticated registry. |
| Draft-order fireworks | **Done, 19 August.** Every pick sends up a shell in that member's own colour as their name lands; first pick gets a nine-shell barrage. Seeded from the event seed, so a replay puts up the same show. Shells launch one reveal-interval early because flight to apex (1.57–1.79 s) exceeds the 1500 ms cadence. |

## Commands

```bash
npm run dev                        # Bot Forge and Arena workbench (arena picker in the Arena view)
npm test                           # ~3 minutes. Includes the golden record tests.
npm run draft -- 100               # Average DRAFT POSITION by part. The number that matters.
npm run arena -- 200 --arena=grinder   # Match-level metrics for one arena
npm run arena -- 500 --ability-ab  # Adrenaline on/off A/B
npm run record -- 10               # Roll ten candidate events and print their draft orders
npm run distribution -- 400        # Plinko slot distribution and per-ball fairness
```

`--arena=` accepts `grinder`, `proving`, or is omitted for the greybox default.

## Performance baseline

Re-measured **17 August**, after the material textures went on the bots, the weapons and the
arena floor. Production build (`npm run preview`, not the dev server, which was stopped so it
could not compete for CPU), Chrome, 2.5x device pixel ratio, sound and particles live.

| | The Gauntlet | The Crossfire | budget |
|---|---|---|---|
| Frame work, median | 1.3 ms | 1.5 ms | — |
| Frame work, p99 | 3.6 ms | 4.0 ms | — |
| **Frame work, worst** | **5.2 ms** | **6.9 ms** | **16.7 ms** |
| Frames over 8 ms | 0 | 0 | — |
| **Dropped frames (delta > 33 ms)** | **1 of 8,155** | **0 of 7,006** | — |
| Peak particles alive | 519 | 764 | 1,100 (the pool) |

**Under half the budget at the worst moment, and no frame anywhere went over 8 ms** across
15,000 frames of two battles. Both held 60 fps throughout.

**Textures cost something, and it lands in the tail rather than the median.** Against the same
measurement taken before them, on the same arenas:

| | Gauntlet before → after | Crossfire before → after |
|---|---|---|
| median | 1.0 → 1.3 ms | 1.3 → 1.5 ms |
| p99 | 2.1 → 3.6 ms | 2.7 → 4.0 ms |
| worst | 3.2 → 5.2 ms | 3.7 → 6.9 ms |

**It is the floor rebuild**, not a uniform per-frame cost. The floor used to be 192 flat
rectangles redrawn every frame — always cheap. It is now a cached layer rebuilt only when a tile
changes, which is usually free and occasionally expensive, and during a spiral collapse tiles
change often enough to trigger repeated rebuilds. Steady state barely moved; the spikes did.

**How the floor texture is mapped turned out to matter more than that it exists.** An
intermediate version mapped a texture per tile and measured a worst frame of **7.7 ms** on The
Gauntlet. Replacing 192 per-tile mappings with a single arena-wide one — done to remove the
visible tiling, not for speed — brought the same measurement down to **5.2 ms**. The buttons and
the oil splats added on top of that cost nothing measurable.

That trade was accepted rather than stumbled into: the alternative was 192 textured fills every
frame, which is worse in every percentile rather than just the tail. If the tail ever needs
reclaiming, the lever is batching tile changes so several collapse together into one rebuild,
at the cost of a frame or two of latency on the collapse warning.

Four things worth knowing before trusting these numbers again:

- **Frame DELTAS cannot measure headroom.** They are floored by vsync at 16.7 ms, so a
  perfectly idle loop and a loop using 90% of its budget both read as 16.7. The work figures
  above come from wrapping `requestAnimationFrame` and timing the callback itself. Measure
  that, not the gaps.
- **This page runs THREE independent rAF loops**, so raw samples arrive at ~180/s and each one
  is a callback, not a frame. Callbacks sharing a timestamp must be summed: 16.7 ms is the
  budget for everything in a frame, not for any one loop's share of it. The 15 August figures
  are per-callback, so the table above reports per-frame and the comparison in the paragraph
  above is stated per-callback to keep it honest.
- **Check the mute button before believing a run.** The first attempt here was captured muted
  and measured the renderer alone. It also came out *slower* than the sound-live run that
  followed, which is a useful reminder that run-to-run noise on this machine is worth about a
  millisecond at the tail — differences smaller than that are not findings.
- **A screen transition costs about 230 ms**, from tearing down one PixiJS renderer and
  building the next. It is the largest hitch in the whole show, it is not the particle layer,
  and it happens between beats rather than during one. Left alone deliberately.

Re-measure with `npm run mix` for the simulation-side counts (voices, particles and burning
flame jets, no browser needed), and by hand in the browser for frame timings.

## The rules that must not be broken

**`src/sim/` is deterministic and lint-enforced.** No `Math.random`, no `Date`, no
transcendental math, no `**` operator, no DOM. A recorded event is just a seed; the site
re-runs the simulation to play it back. Anything that differs between browsers silently
changes every recording ever made.

**Golden record tests are the tripwire.** `tests/determinism.test.ts` and the reference
vectors in `rng.test.ts` / `trig.test.ts` pin actual output, not self-consistency. If one
fails, the simulation changed — decide deliberately whether that was intended, and
re-record if so. Never paste in new numbers to make them pass.

**Any change under `src/sim/` invalidates `data/official-event.json`, and no test will tell
you.** `checksum-gate.test.ts` deliberately does not assert that the shipped record still
verifies — whether it does is a fact about an admin artifact, not about the gate's logic —
so the suite goes green while the site itself would refuse to load. After any simulation
change, re-run `npm run record -- --save <seed>` and confirm it prints `verifies: yes`.

**When a fixture's pinned values move, check the fixture still covers what it claims.**
The reflect fix changed seed 12345's outcome, which quietly took its tiebreak count from 2
to 0 — updating the expectation to "0 place(s)" would have left a green test covering
nothing. The tiebreak fixture now uses seed 7, chosen because it exercises *both* tiebreak
rules (damage and eliminations) in one run. This is the second time a scoring change has
hollowed out a tiebreak fixture this way.

**Damage tracking and scoring are frozen once an event is recorded.**

## The most useful thing we know

**Win rate goes as roughly effective HP to the power 3.5.** Measured three times in The
Grinder, 200 matches each:

| EHP ratio | Win-rate ratio | Implied exponent |
|---|---|---|
| 2.78 : 1 | 35.3 : 1 | 3.49 |
| 1.72 : 1 | 7.0 : 1 | 3.57 |
| 1.37 : 1 | 3.01 : 1 | *predicted 3.02* — used predictively, not fitted |

This is why intuition kept failing on the part tables: a range that looks modest in the
data is extreme in outcomes. **Balancing a durability stat is now arithmetic** — pick a
tolerable win spread, take the 3.53rd root, set the band.

The same amplification explains a pattern that repeated four times in one day: flatten one
category and the next-worst becomes visible. There is no natural end to that, which is why
tuning was stopped deliberately rather than because everything was fair.

## Current balance

Average draft position by part, 100 events, fair value 5.5. Spread = best minus worst.

| Category | Spread | Weakest part |
|---|---|---|
| Weapon | 0.80 | Ram Plate 6.02 |
| Ability | 0.90 | Nitro Boost 6.08 |
| Armour | 1.34 | Carbon Fibre 6.23 |
| Personality | 1.45 | Showman 6.19 |
| Chassis | 1.62 | Wedge 6.04 |
| Drive | 1.94 | **Tank Tracks 6.72** |

**These numbers are provisional.** They are measured across one finished arena and two that
are due to be replaced. Expect them to move when arenas 2 and 3 are built.

## Decisions worth knowing

- **Scoring:** 25/18/15/12/10/8/6/4/2/1 per battle, three battles, **plus 5 points per
  elimination**. Ties break on eliminations, then damage, then member id — that last one is
  not decoration; without it the draft order would depend on sort stability and could
  differ between browsers. It has never fired, and must stay.
- **Kill points are event-wide, not per battle**, because the elimination tally is an event
  sum. Per-battle scoreboards therefore show placement points only, so a member can lead the
  battle-2 scoreboard and not lead the final draft. **The site's reveal has to account for
  this.**
- **Ties are common: 13.3% of placements.** The site must be able to explain *why* a tie
  broke, because it will happen in most events.
- **Member index maps to bot index and ball index.** Fairness comes from the seeded shuffles
  inside the Plinko release and the arena spawn assignment, not from the mapping. Do not add
  another shuffle.
- **Bots have no pathfinding.** They steer toward targets. Simple obstacles are fine; mazes
  are not. There are no interior walls — every wall is on the perimeter.

## What we learned the hard way

Recorded because each one cost hours and none is obvious from the code.

- **Hazard density, not pits, was the lever on combat share.** Removing every pit moved
  combat 32.3% → 35.3%; the deaths just became hazard deaths. Cutting hazards to three saws
  moved it to 88%+.
- **Grip is worth close to nothing.** Aluminium was given +0.12 grip with its durability
  held constant, and got *worse* (6.43 → 6.73). Effective HP fixed it immediately. This also
  explains Tank Tracks, whose headline feature is grip 0.60.
- **Geometry cannot fix retreat.** A tar ring built specifically to punish retreating pushed
  Hit-and-Run from 15.4% to 21.3%, because a bot does not need the wall to break off, only
  open floor. Halving its `disengage` weight fixed it in one pass.
- **Scoring eliminations did not fix survival dominance on its own**, because hit-and-run
  *kills* — it strikes and withdraws, so rewarding kills rewarded it too.
- **Repair and Hit-and-Run were the same problem** wearing two hats: both pay a bot for
  disengaging.
- **A "baseline" option with no upside is a trap.** Aluminium was the worst part in the game
  while having more effective HP than Carbon Fibre.
- **Speed is a defensive stat, not an offensive one.** This one took three falsified
  hypotheses and only fell to instrumentation. Per-appearance figures in The Grinder:

  | | dealt | taken | alive | dealt ÷ alive | taken ÷ alive |
  |---|---|---|---|---|---|
  | Hover | 108.1 | 97.5 | 75.6% | 143.0 | **129.0** |
  | Omni Wheels | 82.7 | 99.8 | 56.1% | 147.4 | **177.9** |

  Damage taken is identical across all six drives (97.5–100.4), and **damage dealt per unit
  of time alive is identical too** (141–147, with Omni Wheels highest). Drives do not differ
  in how hard they fight. The whole difference is the *rate* at which they absorb damage: a
  faster bot can break contact, a slower one is run down and hit in the rear, where chassis
  vulnerability runs 1.7–2.2.

  Two consequences. **Escape is a threshold, not a gradient** — once you are faster than
  your pursuer the extra margin buys nothing, which is why compressing the speed band from
  1.47:1 to 1.20:1 moved Hover only from 24.4% to 23.2%. And **rear vulnerability and drive
  speed are coupled**: rear vulnerability is what makes speed valuable, so tuning either
  one moves the other.

- **A number in a test can be taste rather than a constraint, and only measuring tells you
  which.** The 120-character blurb cap read like a layout limit and was not: its own comment
  called it "the chosen sane maximum", picked to sit above the longest blurb written at the
  time. Rewritten copy ran through it at 143–182, and the honest question was whether the
  reveal cards could take it. Measured with every card holding the longest blurb of its own
  category: nothing clips at 1280, 1120, 1024 or 799 wide. The tightest case is just above
  the 1100px stacking breakpoint, where the column narrows to 158px and 182 characters wrap
  to eight lines — the card grows, and `overflow: hidden` never bites. The cap became 190
  and its comment now records the measurement instead of a preference. **Before cutting good
  work to satisfy a threshold, check whether the threshold was ever measured.**
- **A green summary line is not a passing suite, and this cost a bad commit.** `799db58`
  went in with `tables.test.ts` already failing — the rewritten ability blurbs broke the
  120-character cap above — and the suite was reported as passing. This is the same family
  as the earlier `&&` chain that gated on `tail`'s exit code instead of the build's: in both
  cases a real failure was sitting in output that got summarised rather than read. **Capture
  the exit code into a variable and print it.** `npm test 2>&1 | tail -5` returns the exit
  status of `tail`, which is always 0.
- **Watch the sample size.** Omni Wheels appears ~217 times per 200-match run, so its win
  count is single digits and the standard deviation is about 2.7 wins. A ratio between two
  small counts is not a signal. Compare each part against fair value in standard deviations
  before believing a change did anything.
- **One sample of a moving background is not a measurement, and this nearly shipped
  unreadable text — twice.** Sampling the composite behind the landing's type at intervals
  returned 6.25 on one run and 6.37 on the next for byte-identical CSS; it was missing the
  bright moments. Bounding it the other way — by the brightest pixel anywhere on the canvas —
  gave 2.56, which is pessimistic nonsense, because those pixels are lit background out at
  the margins where the scrim never reaches. The honest figure is the **per-point temporal
  maximum**: for every point in the text box, the brightest that point ever gets, watched over
  ~20 seconds of real motion. On the draft order the same mistake was nearly fatal — one
  nine-second sample read 4.96:1 behind the member names and passed; a second sample of the
  *same build* caught a peak nearly twice as bright, which is white text on near-white gold at
  about **1.45:1**. The names were not marginal, they were periodically unreadable. **Never
  clear a contrast threshold on one pass over something that moves.**
- **`lighter` compositing makes a background brighter than the colour you set.** The landing's
  first version drew lines at 0.22 alpha and measured **0.71** under the tagline, because
  crossings add. Whatever peak opacity a canvas layer is given is a floor, not a ceiling, as
  soon as anything overlaps.
- **Source order only decides paint order between siblings in the same positioning class.** A
  positioned element paints above every static one regardless of where it sits in the markup,
  so prepending an absolutely-positioned canvas does *not* put it behind a static table
  written after it. This cost a pass on the draft order, where the fireworks rained over the
  names. The fix is to make the content positioned too, not to reach for z-index.
- **A determinism test can pass while comparing nothing.** The fireworks' "same seed, same
  show" test ran for 1.4 s, which is before a shell reaches its apex, so it compared two empty
  arrays and passed. Its sibling — "different seed, different show" — is what caught it, by
  failing on those same two empty arrays. **Assert the collection is non-empty before
  asserting anything about its contents.**

## Known issues, unfixed by choice

- **Tank Tracks at 6.72** is the weakest part. Its selling point is grip, which we measured
  as near-worthless. One-line speed fix available; deliberately not taken, to stop the
  flatten-one-category-and-promote-the-next cycle.
- **Survival builds take 38% of top picks** against a fair 28.6%. Down from 55%.
- **A zone notice margin of 220 units** in `perception.ts` was chosen by eye, never measured.
- **The eliminations tiebreak resolves fewer cases than it used to** now that kills feed
  points directly, but it still fires most often of the three.
- **A PixiJS `Filter` throws while being destroyed**, on the screens that mount a renderer:
  `Cannot read properties of undefined (reading 'push')`. Nothing visible breaks, because
  `runTeardown` in `router.ts` exists precisely for this class of bug and swallows it — that
  guard was written for an earlier one of these (`_cancelResize is not a function`) which
  stranded viewers on the previous screen permanently. Left alone this close to the deadline:
  it is noise in the console, not a fault on the screen. Confirmed not to come from the
  landing or the draft order, whose teardowns are pure DOM and throw nothing.

## Queued decisions — after the three arenas are locked

Both deliberately deferred, because arena geometry changes the answer to each.

**1. How much is a kill worth?** `KILL_POINTS` is 5, a first-draft number. Compare 1 vs 3
vs 5 and read the effect on draft position and on survival-personality share. The harness
for this is `npm run draft`, which already reports both.

**2. What counts as a kill?** *A direct bot-on-bot final blow, and — as of 12 August — a
kill earned by Spiked Composite's damage reflect.* See the `eliminate()` call sites in
`match.ts`: contact damage credits the other bot; a `destroyed` death from any zone,
projectile or hazard credits nobody, and a `fell` death credits nobody.

The reflect case was **a bug, not a policy**, and is now fixed. Only the target's health was
checked at the hit site, so a bot that impaled itself on someone's spikes fell through to
the health sweep, which credits `byId: null` — the kill feed read a bare "destroyed", as if
a hazard had done it. Spotted by watching a single match, where it landed on the *final*
elimination of a battle and read as obviously wrong. Both directions of an exchange are now
checked, so a mutual kill credits both bots. Covered by `match.test.ts`'s
"credits a reflect kill to the owner of the spiked armour".

The remaining uncredited moments, several of which are the most watchable in the game:

| Moment | Credited today |
|---|---|
| Shove a bot into a pit or off the edge | **No** |
| Trigger a cannon whose ball lands the killing blow | **No** |
| Shove a bot into a saw | **No** |
| Kill with a Shockwave launch | **No** |
| Kill via Spiked Composite damage reflect | **Yes** (the kill only — reflect still does not credit `damageDealt`) |

This interacts directly with arena design: in The Grinder falls are only 1.8% of deaths so
it barely matters, but an arena built around a trapdoor or ejection gaps would have a large
share of its best moments score nothing. **Decide this before finalising an arena whose
drama depends on pits.**

## What is deliberately cut for this deadline

Blender-baked sprite art, sound design, arenas 4 and 5, the Arena Builder, interior
obstacles, the three-component weapon model. All are next year's.

**Atmosphere tier 4b** — hazard stripes, warning labels, technical markings, rivets in the
chrome — is cut on its merits rather than for time. Every existing atmosphere element is
light: the vignette, the haze, the reactive glow, the ember on the buttons, the smoke on the
landing. None of it pretends to be a physical object, which is why the site reads as a venue
rather than as a theme. Rivets and stripes would be the first literal ornament, and they carry
a scale trap with no good answer — small enough to be quiet is small enough to be invisible,
and large enough to read pulls the eye to the corners of panels whose job is a column of names
and numbers. If any of it is ever revisited, technical markings are the one worth having,
because they add texture through information rather than decoration.

## Where the reasoning lives

Design specs in `docs/superpowers/specs/`, implementation plans in
`docs/superpowers/plans/`. Commit messages are deliberately detailed — several record
measurements and failed approaches that are not obvious from the code.
