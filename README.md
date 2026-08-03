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

## Status

Design approved. Implementation not yet started.
