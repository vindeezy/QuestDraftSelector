import { advanceMatch, createMatch, DEFAULT_MATCH, type Match } from '../../sim/arena/match';
import type { Effect } from '../../sim/arena/effects';
import { assemble, type BotBuild } from '../../sim/parts/assemble';
import { ARENA_VARIANTS, ARENA_VARIANT_NAMES } from '../../sim/event/arenas';
import { ROSTER, toEventMembers, type RosterMember } from '../../config/roster';
import { createArenaRenderer, type ArenaRenderer } from '../../render/arena-renderer';
import { nextBeat, type BeatId } from '../beats';
import { canvasSupportsWebGL } from '../canvas-support';
import { sharedAudioBus } from '../audio';
import { emptyState, playFrame, tickToMs } from '../../audio/play';
import { mountAudioControls, mountPauseControl, mountReplayControl } from './audio-controls';
import { getEventResult, memberBallVisuals } from './forge';
import type { Screen, ScreenContext } from './types';

/**
 * Beats 11, 13 and 16 — the three battles: The Grinder, The Gauntlet, The Crossfire.
 * The centrepiece of the whole site: replaying a recorded seed with the assembled builds,
 * live, tick by tick, so the league watches the exact fight that already decided their
 * draft order. See `docs/superpowers/specs/2026-08-11-website-design.md` §2 (rows 11, 13,
 * 16), §5 and §6.
 *
 * Structurally this follows `forge.ts` closely — same replay-not-re-roll contract, same
 * fixed-ticks-per-frame pacing, same explicit-start-then-Continue gate, same no-WebGL
 * fallback discipline — because it is the same trust model applied to a different
 * simulation. Where the two differ, the reason is called out below.
 */

/**
 * Ticks of physics advanced per animation frame. Fixed, never derived from measured frame
 * delta — see `forge.ts`'s identical doc comment on `TICKS_PER_FRAME` for why that matters
 * for determinism and for a backgrounded tab.
 *
 * 1 — real time — for the same reason `forge.ts` settled on 1 for the Forge board:
 * `DEFAULT_MATCH.maxTicks` is 18000, documented in `match.ts` as "five minutes at 60 ticks
 * per second", and `record-event.ts`'s own `formatSeconds` (`ticks / 60`) treats that as
 * the simulation's native real-time base rather than an arbitrary number. Five sampled
 * seeds' battle lengths at that rate run 64-178 seconds (`npm run record -- 5`), squarely
 * inside the spec's 2-3 minute target, with the stated 8,000-14,000 tick range landing at
 * roughly 2.2-3.9 minutes — occasionally a little over on the longest matches, the same
 * kind of natural variance `forge.ts` already accepts for board settling time. Doubling
 * the rate would pull the middle of that range under two minutes, which is the wrong
 * direction to correct in.
 */
export const TICKS_PER_FRAME = 1;

/** How long the arena holds on its finished state before the Continue control appears —
 *  the "beat to read the result" the spec asks for. Same idea and same order of magnitude
 *  as `forge.ts`'s `RESULTS_READ_DELAY_MS`, just a little longer: a battle's finish is a
 *  bigger moment than one Forge board settling. */
const RESULTS_READ_DELAY_MS = 1200;

const BATTLE_BEAT_IDS = ['battle-1', 'battle-2', 'battle-3'] as const;
const BATTLE_BEAT_INDEX: ReadonlyMap<BeatId, number> = new Map(
  BATTLE_BEAT_IDS.map((id, index) => [id, index]),
);

/** This beat's 0-based battle index, or `null` for any beat that isn't one of the three
 *  battles — the same "is this one of mine, and which" shape `categoryForBeat` gives the
 *  Forge. */
export function battleIndexForBeat(id: BeatId): number | null {
  return BATTLE_BEAT_INDEX.get(id) ?? null;
}

/** "Battle 2 of 3 — The Gauntlet", matching the wording the spec's own copy uses. */
export function battleLabelFor(battleIndex: number): string {
  return `Battle ${battleIndex + 1} of 3 — ${ARENA_VARIANT_NAMES[battleIndex]}`;
}

/**
 * Builds the same `MatchConfig` `runBattle` (private to `sim/event/event.ts`) built to
 * produce this battle's recorded result: the battle's own arena variant, `seed` and
 * `builds` taken from the recorded event, assembled the same way `runEvent` assembles
 * them. Stepped to completion via `advanceMatch`, it reaches the same final state by
 * construction — `battle.test.ts`'s trust-model test checks that equality directly,
 * seed by seed, the same way `forge.test.ts` checks `replayForgeBoard`.
 */
export function replayBattle(
  seed: number,
  battleIndex: number,
  builds: readonly BotBuild[],
  memberCount: number,
): Match {
  return createMatch({
    ...DEFAULT_MATCH,
    arena: ARENA_VARIANTS[battleIndex]!,
    botCount: memberCount,
    seed,
    builds: builds.map((build) => assemble(build)),
  });
}

/** `bot-3` -> 3. Bot ids are always `bot-${memberIndex}` — see `createMatch`'s doc
 *  comment in `match.ts` and `event.ts`'s identical `botIdToIndex`, duplicated here rather
 *  than imported since `src/shell/` reaching into a private helper of `src/sim/event/`
 *  isn't a boundary this feature should cross either. */
function botIndexFromId(botId: string): number {
  return Number(botId.slice('bot-'.length));
}

/**
 * Ranks a finished match's bots exactly the way `match.ts`'s own (unexported)
 * `buildPlacements` does: survivors first (by remaining health, then id), then eliminated
 * bots in reverse death order. Returns places indexed to match member/bot index, the same
 * shape `BattleResult.places` already has.
 *
 * Duplicated rather than imported — this feature does not modify `src/sim/`, and
 * `buildPlacements` is private to `match.ts` — but the duplication cannot silently drift:
 * `battle.test.ts`'s trust-model test compares this function's output directly against
 * `runEvent`'s own recorded places, which are built from the real `buildPlacements`. If
 * the two ever disagree, that test fails immediately.
 */
export function placesFromFinishedMatch(match: Match, memberCount: number): number[] {
  const survivors = match.bots.filter((bot) => bot.alive);
  survivors.sort((a, b) => {
    if (b.health !== a.health) return b.health - a.health;
    return a.body.id < b.body.id ? -1 : 1;
  });

  const order: string[] = survivors.map((bot) => bot.body.id);
  for (let i = match.eliminations.length - 1; i >= 0; i--) {
    order.push(match.eliminations[i]!.botId);
  }

  const places = new Array<number>(memberCount);
  order.forEach((botId, index) => {
    places[botIndexFromId(botId)] = index + 1;
  });
  return places;
}

/**
 * Advances `match` by up to `ticks` ticks (fewer once it finishes), draining
 * `match.effects` into `buffer` after *each* individual `advanceMatch` call rather than
 * once at the end.
 *
 * `match.effects` is cleared at the START of every tick (see the doc comment on
 * `Match.effects` in `match.ts`, and §6 of the design spec), so a single read after
 * several ticks have run would only ever see the last tick's effects — every earlier
 * tick's would already be gone. Draining after each call is what keeps a multi-tick frame
 * from silently losing that data; `battle.test.ts` checks this directly by comparing a
 * one-tick-at-a-time drive against a chunked one over the same span and requiring an
 * identical buffer.
 *
 * Nothing reads `buffer` yet — sound and VFX are a later plan (see the module doc comment
 * and design spec §6/§7) — but the draining has to be correct now, since it cannot be
 * retrofitted onto ticks whose effects were already thrown away.
 */
export function advanceBattleFrame(match: Match, ticks: number, buffer: Effect[]): void {
  for (let i = 0; i < ticks && !match.done; i++) {
    advanceMatch(match);
    buffer.push(...match.effects);
  }
}

/** The no-WebGL fallback — same visual vocabulary as `forge.ts`'s own board fallback and
 *  `what-to-expect.ts`'s arena preview fallback, since all three are the same site
 *  reacting to the same limitation. There is no live arena or kill feed to draw here, so
 *  this is a static note naming the battle rather than an attempt to show one. */
function mountBattleFallback(host: HTMLElement, battleIndex: number): void {
  const el = document.createElement('div');
  el.className = 'expect-visual__fallback battle-arena__fallback';
  el.innerHTML = `
    <div class="fallback-arena" aria-hidden="true">
      ${Array.from({ length: 6 }, () => '<span class="fallback-bot"></span>').join('')}
    </div>
    <p class="fallback-note">Press BEGIN to start ${ARENA_VARIANT_NAMES[battleIndex]}. Last bot standing wins.</p>
  `;
  host.appendChild(el);
}

export function battleScreen(beat: BeatId): Screen {
  const battleIndex = battleIndexForBeat(beat);
  if (battleIndex === null) {
    throw new Error(`battleScreen: "${beat}" is not one of the three battle beats.`);
  }

  return {
    render(ctx: ScreenContext) {
      const members: readonly RosterMember[] = ROSTER;
      const event = getEventResult(ctx.seed, toEventMembers(members));
      const battle = event.battles[battleIndex]!;
      const match = replayBattle(battle.seed, battleIndex, event.builds, members.length);

      const claimedIndex = ctx.state.claimedMemberId
        ? members.findIndex((member) => member.id === ctx.state.claimedMemberId)
        : -1;
      const highlightIndex = claimedIndex >= 0 ? claimedIndex : null;

      const root = document.createElement('section');
      root.className = 'screen screen-battle';
      root.innerHTML = `
        <div class="battle-header">
          <p class="battle-progress">Battle ${battleIndex + 1} of 3</p>
          <h1 class="battle-arena-name">${ARENA_VARIANT_NAMES[battleIndex]}</h1>
        </div>
        <div class="battle-layout">
          <div class="battle-arena" data-role="arena">
            <button type="button" class="btn btn-primary btn-large forge-overlay-btn battle-start-btn" data-role="start">BEGIN</button>
            <button type="button" class="btn btn-primary btn-large forge-overlay-btn" data-role="continue" hidden>Continue</button>
          </div>
        </div>
      `;

      const arenaHost = root.querySelector<HTMLElement>('[data-role="arena"]')!;
      const startButton = root.querySelector<HTMLButtonElement>('[data-role="start"]')!;
      const continueButton = root.querySelector<HTMLButtonElement>('[data-role="continue"]')!;

      let stopped = false;
      let unmounted = false;
      let frame = 0;
      let readTimer: ReturnType<typeof setTimeout> | null = null;
      let renderer: ArenaRenderer | null = null;

      // The bus is already unlocked -- BEGIN on the landing screen did it several beats ago,
      // which is the only click browsers will accept for the whole event. Each battle starts
      // from a FRESH mixer state: three battles share one bus but must not share a voice
      // budget, or battle two would open with battle one's voices still counted against it.
      const bus = sharedAudioBus();
      let voices = emptyState();
      let unmountAudioControls: (() => void) | null = null;

      // The arena's canvas is drawn at a fixed native resolution (the grid's own pixel
      // size plus the kill-feed margin, `arena-renderer.ts`'s `KILL_FEED_WIDTH`) — never
      // measured from the host element the way `build-reveal.ts`'s portrait is. CSS alone
      // (`object-fit: contain`, the same rule `.forge-board canvas` already uses) letterboxes
      // that fixed-resolution canvas into whatever room `.battle-arena` has, on any window
      // size, with nothing to go stale on resize and so nothing to re-measure — the same
      // reason `forge.ts`'s own board never needed a resize listener either.
      if (canvasSupportsWebGL()) {
        // `result.builds` is what turns ten identical circles into ten machines: the
        // renderer draws each bot's real chassis, armour and weapon rather than a disc.
        void createArenaRenderer(
          arenaHost,
          match,
          highlightIndex,
          new Map(),
          memberBallVisuals(members),
          event.builds,
        ).then(
          (created) => {
            if (unmounted) created.destroy();
            else renderer = created;
          },
        );
      } else {
        mountBattleFallback(arenaHost, battleIndex);
      }

      function scheduleContinue(): void {
        readTimer = setTimeout(() => {
          readTimer = null;
          continueButton.hidden = false;
        }, RESULTS_READ_DELAY_MS);
      }

      const tick = (): void => {
        if (stopped) return;
        // Paused stops scheduling rather than skipping work, so a paused battle costs nothing.
        // Resuming re-enters the loop from the pause control's own handler.
        if (pauseControl.paused) return;

        const frameEffects: Effect[] = [];
        advanceBattleFrame(match, TICKS_PER_FRAME, frameEffects);

        // The consumption point WEB 4 reserved. Read once per rendered frame, after every
        // tick that ran this frame has contributed to it -- which is why `advanceBattleFrame`
        // accumulates rather than the loop reading `match.effects` directly: at more than one
        // tick per frame the earlier ticks' effects would already have been cleared.
        //
        // Clocked off the simulation's own tick count, not the wall. A machine that cannot
        // keep 60fps should get the same mix as one that can, and `performance.now()` here
        // would quietly thin the sound out on exactly the laptop that is already struggling.
        voices = playFrame({
          bus,
          effects: frameEffects,
          builds: event.builds,
          state: voices,
          nowMs: tickToMs(match.world.tick),
          width: match.arena.grid.width,
        });

        // The same accumulated bus the sound layer just read, for the same reason: at more
        // than one tick per frame `match.effects` holds only the last tick's events.
        renderer?.draw(match, frameEffects);

        if (match.done) {
          pauseControl.conceal();
          replayControl.reveal();
          scheduleContinue();
          return;
        }
        frame = requestAnimationFrame(tick);
      };

      // The battle is triggered, not automatic: the arena mounts and holds at rest — no
      // ticks advanced, every bot at its spawn position — until BEGIN is pressed. Same
      // anticipation beat as `forge.ts`'s DROP 'EM; once pressed, the button is gone for
      // good.
      startButton.addEventListener('click', () => {
        // Unlocked on the landing screen several beats ago, and unlocked AGAIN here. A context
        // suspended while the viewer was on another screen only comes back from inside a user
        // gesture, and this is the last one before the battle makes any noise.
        bus.unlock();
        startButton.hidden = true;
        pauseControl.reveal();
        frame = requestAnimationFrame(tick);
      });

      continueButton.addEventListener('click', () => {
        ctx.navigate(nextBeat(beat)!);
      });

      // Docked under Back rather than in the battle's own header, where the slider sat over
      // the arena's name.
      unmountAudioControls = mountAudioControls({ bus, host: ctx.controls });
      const replayControl = mountReplayControl(ctx.controls, ctx.replay);
      const pauseControl = mountPauseControl(ctx.controls, (isPaused) => {
        if (!isPaused && !match.done && !stopped) frame = requestAnimationFrame(tick);
      });

      ctx.container.appendChild(root);

      return () => {
        stopped = true;
        unmounted = true;
        cancelAnimationFrame(frame);
        if (readTimer !== null) clearTimeout(readTimer);
        // DOM cleanup before the renderer, deliberately. `renderer.destroy()` is the one
        // step here that has actually thrown in the wild -- see the router's `runTeardown`
        // comment -- and anything after a throw never runs. The router catches it and moves
        // on, so the cost of being second in this list is a control left behind on screen.
        unmountAudioControls?.();
        replayControl.destroy();
        pauseControl.destroy();
        renderer?.destroy();
      };
    },
  };
}
