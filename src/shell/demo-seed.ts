/**
 * The seed the "What to expect" screen's two live preview panels run on — the ball-drop
 * loop and the miniature arena (see
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2.1).
 *
 * This must never be the official event's seed. The orientation screen exists to build
 * excitement *before* the real Forge and the real battles, and showing the actual draft
 * order's boards or fights here — even in miniature, even looping — would let a sharp-
 * eyed viewer read tomorrow's result today. A fixed, unrelated constant is what keeps
 * this screen a preview instead of a leak.
 *
 * `checksum-gate.test.ts`-adjacent coverage (`demo-seed.test.ts`) asserts this differs
 * from `data/official-event.json`'s `masterSeed` directly, so a future edit that
 * accidentally points this at the real seed fails loudly instead of quietly spoiling the
 * event.
 */
export const DEMO_SEED = 918273645;
