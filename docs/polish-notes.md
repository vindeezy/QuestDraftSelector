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

- **The ten member colours.** Fine as tiles on a dark screen; the real test is ten of them
  moving at 40-unit bot size in a brawl. Watch for **Tommy's black** disappearing into the
  dark slate floor (it is meant to carry a light outline), and whether **gold/yellow** and
  **white/silver** separate. Arrives properly at the WEB 9 battle gate.
- **No visible way to go back** during a first watch. `progress.ts` allows it — any
  already-seen beat is reachable — but nothing on screen offers it. `?reset` exists as the
  escape hatch. Whether members want in-watch back navigation is a real question.
- **Battle 1 gets one scoreboard where battles 2 and 3 get two.** Correct (a second screen
  would show identical data) but it makes the walkthrough's rhythm uneven, and the
  transitions may need to acknowledge that.

## Done

*Nothing yet.*

## Open

- **The build reveal's portrait overlaps its info cards on a narrow window.** Seen at roughly
  800x1040 while checking MAT 1: the bot covers the card text on both sides, and the weapon
  overlaps the member name in the header. Fine at 1600 wide, where the cards sit clear of it.
  Not caused by the textures — the portrait scales off its own drawn bounds, which materials do
  not change — so this predates them. Whether it matters depends on what the league watches on;
  if anyone is on a laptop or a tablet in portrait, it does.
- **Aluminium armour may read as "no texture applied".** It is deliberately the smoothest and
  lightest material — its lack of features is how it is told apart from Titanium and Alloy — but
  next to Hardened Steel's obvious rivets, a viewer on the reveal may reasonably conclude that
  their bot missed out. Judge at the MAT 1 gate. If it needs help, the fix is a slightly stronger
  mottling rather than adding features it should not have.
