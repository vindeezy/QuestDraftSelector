# Polish notes

Running list of UI/UX, copy, layout and motion feedback, collected as the site is built
and acted on in one pass near the end.

**Why a list rather than fixing as we go:** the remaining watch gates come in quick
succession, and stopping to polish each one would stall the build while the deadline is
the real risk. Everything here is cheap to change late — copy is plain strings in the
screen modules, layout and background are `src/shell/shell.css`, and the router already
gives each screen a teardown, so entrance animation is additive per screen and exit
animation needs one small backward-compatible router change.

**The tools for the pass:** the `impeccable` skill is installed in this project and has
`animate`, `polish`, `bolder` and `critique` commands plus 59 local detector rules. The
PixiJS `pixijs-filters` and `pixijs-blend-modes` skills cover anything happening on canvas.

**Deadline discipline:** polish stops on **26 August**. After that the remaining time goes
to choosing the official seed, screening its three battles through `npm run replay`, and
deploying. A beautiful site with an unscreened event is worse than a plain one with a good
event.

---

## Known from the build, not yet judged on screen

Things flagged during implementation that need a human eye before anyone can say whether
they are actually wrong.

- **No visible way to go back** during a first watch. `progress.ts` allows it — any
  already-seen beat is reachable — but nothing on screen offers it. `?reset` exists as the
  escape hatch. Whether members want in-watch back navigation is a real question.
- **Battle 1 gets one scoreboard where battles 2 and 3 get two.** Correct (a second screen
  would show identical data) but it makes the walkthrough's rhythm uneven, and the
  transitions may need to acknowledge that.

## Done

- **The ten member colours.** Answered, and the answer was worse than the question assumed. The
  material textures MULTIPLY, so each bot was darkened by its own armour's brightness — putting
  the armour on the same channel as the identity. Measured in CIELAB, the closest pair went from
  30.8 apart to 7.5. White/silver and gold/yellow were both confirmed, and red/pink and
  orange/gold turned out to be collisions too. Fixed by lowering the texture's strength (white is
  already `#ffffff`, so no hex could have rescued it) and then choosing the hexes by search rather
  than by eye: worst pair 34.0. Tommy's black is fine — the light outline does its job, and the
  lightened floor helps it further.
- **The build reveal's portrait overlaps its info cards on a narrow window.** Fixed. Two separate
  faults. `portraitSizeFor` had a floor of 380 while `.reveal-arena`'s centre track can shrink to
  280, so between those the canvas was wider than the track it sat in and simply spilled over —
  the exact failure its own doc comment warned about, reintroduced by the clamp meant to prevent
  it. And the side tracks are `minmax(0, 1fr)`, so by 800px they collapsed to ~48px: a column of
  single words. Below 1100px the layout now stacks — machine above, cards beneath in as many
  columns as fit — and the leader lines go with it, since a line pointing sideways at a card that
  is now underneath draws a relationship that has stopped being true. Verified by measurement at
  900 and 1600: zero overlap, zero horizontal overflow, and the wide layout unchanged.

## Open

- **Aluminium armour may read as "no texture applied".** It is deliberately the smoothest and
  lightest material — its lack of features is how it is told apart from Titanium and Alloy — but
  next to Hardened Steel's obvious rivets, a viewer on the reveal may reasonably conclude that
  their bot missed out. Judge at the MAT 1 gate. If it needs help, the fix is a slightly stronger
  mottling rather than adding features it should not have.

## Found while fixing, worth knowing

- **A horizontal scrollbar can appear from a pseudo-element, not a box.** The reveal stage's glow
  `::before` is 756px inside a 600px stage, and the wide layout has always relied on the screen's
  `overflow: hidden` to clip it. The stacked layout initially set `overflow: visible`, copying the
  short-viewport block, and the glow pushed the document 13px wider than the viewport. Nothing
  showed up as an oversized element, because no element WAS oversized. If a screen ever grows a
  mysterious horizontal scrollbar, check the decorations before the boxes.
