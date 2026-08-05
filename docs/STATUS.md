# Project status

Last updated: 2026-08-05

**Deadline: end of August 2026.** The league needs a working draft-order experience.

## What works today

| Piece | State |
|---|---|
| Deterministic sim core | Done. Seeded PRNG, fixed-tick physics, collision, checksums, lint-enforced determinism. |
| Bot Forge (Plinko) | Done. Ten balls, fair, replays byte-identically from a seed. |
| Arena | Done. Vehicle movement, directional combat with front/side/rear armour, seven driver personalities, spiral floor collapse guaranteeing one survivor. |
| Hazards | Done. Twelve presets over five primitives: surfaces, zones, holes, projectiles, buttons. |
| Event pipeline | Done. Seven Forge boards + three battles + scoring + draft order, all from one master seed. |
| Recording | Done. `npm run record -- 10` rolls candidates; `--save <seed>` writes the official record. |
| Website | **Not started.** This is the remaining critical path. |
| Bot categories | **Not started.** The Forge reports slot numbers, not named parts. |

## Commands

```bash
npm run dev              # Bot Forge and Arena workbench
npm test                 # ~3 minutes. Includes the golden record tests.
npm run record -- 10     # Roll ten candidate events and print their draft orders
npm run record -- --save <seed>   # Save an official event
npm run arena -- 80      # Arena balance metrics
npm run distribution -- 400       # Plinko slot distribution and per-ball fairness
```

## The rules that must not be broken

**`src/sim/` is deterministic and lint-enforced.** No `Math.random`, no `Date`, no
transcendental math, no `**` operator, no DOM. A recorded event is just a seed; the site
re-runs the simulation to play it back. Anything that differs between browsers silently
changes every recording ever made.

**Golden record tests are the tripwire.** `tests/determinism.test.ts` and the reference
vectors in `rng.test.ts` / `trig.test.ts` pin actual output, not self-consistency. If one
fails, the simulation changed — decide deliberately whether that was intended, and
re-record if so. Never paste in new numbers to make them pass.

**Damage tracking and scoring are frozen once an event is recorded.** Adding a stat or
changing the points table after recording invalidates the record.

## Decisions worth knowing

- **Scoring:** 25/18/15/12/10/8/6/4/2/1 per battle, three battles. Ties break on total
  eliminations, then damage dealt, then member id (that last one is not decoration — without
  it the draft order would depend on sort stability and could differ between browsers).
- **Three arena variants:** The Grinder, The Gauntlet, The Crossfire — one per battle.
- **Member index maps to bot index and ball index.** Fairness comes from the seeded
  shuffles inside the Plinko release and the arena spawn/personality assignment, not from
  the mapping. Do not add another shuffle.
- **Bots have no pathfinding.** They steer toward targets. Simple obstacles are fine;
  mazes are not.

## Known issues, unfixed by choice

- **Battle 3 (The Crossfire) is much shorter than battles 1 and 2** — typically 60s versus
  100–170s. Its emitters kill fast. The battle that decides the draft is currently the
  least dramatic.
- **Ties are more common than expected.** Six of ten sampled events needed at least one
  tiebreak. The chain handles them and records which rule applied, but it happens often.
- **Balance is uneven.** Survival personalities (Hit-and-Run, Defensive) take roughly half
  of all wins. Arena geometry that punishes retreating is the intended lever, not more
  weight tuning.
- **A zone notice margin of 220 units** in `perception.ts` was chosen by eye, never measured.

## What is deliberately cut for this deadline

Blender-baked sprite art, sound design, arenas 4 and 5, the Arena Builder, the
three-component weapon model (collision / passive contact / active). All are next year's.

## Where the reasoning lives

Design specs in `docs/superpowers/specs/`, implementation plans in
`docs/superpowers/plans/`. Commit messages are deliberately detailed — several record
measurements and failed approaches that are not obvious from the code.
