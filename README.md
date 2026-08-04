# Quest Draft Selector

A pre-recorded, randomly-determined simulation event that decides the draft order for a
10-member fantasy football league — published as a website members watch like a movie.

Members don't play. They pick their name, hit Begin, and watch how it already unfolded,
with their own bot glowing so they can follow it.

## The events

1. **The Bot Forge** — a Plinko ceremony. Seven rounds, one per bot category. All ten
   balls drop at once. Where they land builds each member's Battle Bot at random.
2. **The Arena** — a top-down battle royale. Ten AI-driven bots, one survivor.
   Placement order sets the draft order.

## How it works

Every event runs on a **deterministic simulation core** seeded by a single number. The
"official" recording of an event is a few hundred bytes — a seed, an arena, and the bot
configurations — and replaying it reproduces the event identically on any machine,
in any browser, forever.

That means: no backend, no database, no accounts, and **$0 hosting in perpetuity**.

## Structure

```
sim/     Pure logic. No pixels, no DOM. Fixed 60Hz timestep. Runs headless.
render/  PixiJS. Draws sim state. Knows no game rules.
shell/   Page UI, playback controls, member selection.
docs/    Design spec and art-direction studies.
```

`sim/` never imports from `render/` or `shell/`. Everything else depends on that rule.

## Docs

- [Design spec](docs/superpowers/specs/2026-08-03-quest-draft-selector-design.md) — the
  full design, locked decisions, and 10-phase roadmap.
- [Art direction study](docs/design/art-direction-study.html) — a live, non-deterministic
  Canvas 2D mockup establishing look and feel. Open it in a browser.

## Running it

```bash
npm install
npm run dev
```

Enter a seed, hit Run, watch ten balls fall. The same seed always produces the same
result. Ball 1 is highlighted, standing in for "the member watching" until real
league data exists.

Other commands:

```bash
npm test                     # 87 tests. Takes ~3 minutes; the determinism suite
                             # runs several hundred full simulations.
npm run distribution -- 400  # measures slot rarity AND per-ball fairness
npm run lint                 # enforces the sim determinism contract
```

## Status

**Phases 1–2 complete.** The deterministic core and the Bot Forge simulation work.
Ten balls drop, collide, and land in slots; the same seed replays byte-identically.

Not yet built: the seven bot categories (balls land in numbered slots, not named
parts), real visuals, audio, the Arena, and the viewing website. See the
[roadmap](docs/superpowers/specs/2026-08-03-quest-draft-selector-design.md#12-build-roadmap).

**Open tuning question:** the outer "jackpot" slots currently take ~7% of balls each,
where the design targets 0.2%–1.5%. The board is fair — every member has the same
expected outcome — but jackpots are not yet rare enough to feel special.
