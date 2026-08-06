import { DEFAULT_BOARD } from '../sim/plinko/board';
import { DEFAULT_PLINKO, advance, createPlinkoRun } from '../sim/plinko/plinko';
import { createPlinkoRenderer, type PlinkoRenderer } from '../render/plinko-renderer';
import { DEFAULT_ARENA, PROVING_ARENA, GRINDER_ARENA, type ArenaConfig } from '../sim/arena/arena';
import { DEFAULT_MATCH, advanceMatch, createMatch, type Match } from '../sim/arena/match';
import { ARENA_VARIANTS, ARENA_VARIANT_NAMES } from '../sim/event/arenas';
import { buildsForSeed } from '../sim/parts/forge';
import type { AssembledBot } from '../sim/parts/assemble';
import { createArenaRenderer, type ArenaRenderer } from '../render/arena-renderer';

/**
 * Three-letter personality tags for the renderer's on-bot labels.
 *
 * Lives in the shell, not the renderer, because the renderer must not import the AI or
 * personality modules — it only knows about a `Map<string, string>` it is handed.
 */
const PERSONALITY_TAGS: Record<string, string> = {
  aggressive: 'AGG',
  defensive: 'DEF',
  hitAndRun: 'H&R',
  thirdParty: '3RD',
  chaos: 'CHA',
  showman: 'SHO',
  instigator: 'INS',
};

/**
 * Builds the bot-id -> label map the renderer draws under each living bot: the three-letter
 * personality tag, plus (when `builds` is supplied) the chassis and armour that bot was
 * assembled with — the whole point of watching a real Forge-built roster is being able to
 * tell, at a glance, which bot is the Depleted Uranium one.
 *
 * Personality is read from `match.aiStates`, not `builds`, but the two never disagree: when
 * `builds` is supplied to `createMatch`, it is `createMatch` itself that seeds every bot's
 * `aiStates` personality from `build.personality` (see `match.ts`) — `aiStates` is simply
 * where the running match keeps it. Reading it from there, rather than re-deriving it here,
 * means this function never has to know how bot index maps to build index.
 */
function buildBotTags(match: Match, builds: AssembledBot[] | null): Map<string, string> {
  const tags = new Map<string, string>();
  match.bots.forEach((bot, index) => {
    const personality = match.aiStates.get(bot.body.id)?.personality;
    if (!personality) return;
    const tag = PERSONALITY_TAGS[personality] ?? personality;
    const build = builds?.[index];
    tags.set(bot.body.id, build ? `${tag}\n${build.partLabels.chassis} · ${build.partLabels.armour}` : tag);
  });
  return tags;
}

/**
 * A workbench for experimenting with the board, not the finished viewer.
 *
 * Two kinds of dial live here, and the difference matters:
 *
 * - Playback speed is PRESENTATION. It changes how fast you watch the drop and has
 *   no effect whatsoever on where the balls land.
 * - Everything else is SIMULATION. Changing max speed, ball count, or slot count
 *   produces a genuinely different event for the same seed.
 *
 * The official recording will use the defaults. These controls exist so the numbers
 * can be felt before being committed to.
 */

/**
 * Upper bound on the max-speed dial.
 *
 * A body can never travel further in one tick than max speed, so keeping it below the
 * smallest collision pair — peg radius 6 plus ball radius 13, so 19 — is what stops
 * balls passing straight through pegs. 12 leaves a wide margin.
 */
const MAX_SPEED_CEILING = 12;

/** Mounts the Bot Forge (Plinko workbench) into `container`. Returns a teardown. */
function mountForge(container: HTMLElement): () => void {
  const controls = document.createElement('div');
  controls.style.cssText = `
    display:flex; flex-wrap:wrap; gap:18px; align-items:flex-end; margin-bottom:14px;
    padding:14px 16px; background:#0d1119; border:1px solid #1a2230; border-radius:8px;
    max-width:720px; box-sizing:border-box;
  `;
  controls.innerHTML = `
    <style>
      .dial { display:flex; flex-direction:column; gap:5px; }
      .dial > span:first-child {
        font-size:10px; letter-spacing:.11em; text-transform:uppercase; color:#5b6a80;
      }
      .dial input[type=range] { width:132px; accent-color:#4aa8ff; }
      .dial input[type=number] {
        width:104px; background:#141b26; color:#dbe4ef; border:1px solid #24303f;
        border-radius:4px; padding:5px 7px; font:inherit;
      }
      .val { color:#dbe4ef; font-variant-numeric:tabular-nums; font-size:12.5px; }
      .note { color:#4d5a6b; font-size:11px; }
      #shell-controls button {
        background:#1a2432; color:#9fb0c6; border:1px solid #26344a; border-radius:5px;
        padding:7px 14px; font:inherit; font-size:12.5px; cursor:pointer;
      }
      #shell-controls button:hover { background:#22304a; color:#e2e9f2; }
      #shell-controls button.primary { background:#1f3a5c; color:#9fd0ff; border-color:#2d5482; }
    </style>

    <label class="dial"><span>Seed</span>
      <input id="seed" type="number" value="4242">
    </label>

    <label class="dial"><span>Max speed <b class="val" id="speedVal">5.5</b></span>
      <input id="speed" type="range" min="1.5" max="${MAX_SPEED_CEILING}" step="0.5" value="5.5">
    </label>

    <label class="dial"><span>Playback <b class="val" id="playVal">1x</b></span>
      <input id="play" type="range" min="1" max="6" step="1" value="1">
    </label>

    <label class="dial"><span>Balls <b class="val" id="ballsVal">10</b></span>
      <input id="balls" type="range" min="2" max="12" step="1" value="10">
    </label>

    <label class="dial"><span>Slots <b class="val" id="slotsVal">9</b></span>
      <input id="slots" type="range" min="3" max="15" step="1" value="9">
    </label>

    <div style="display:flex; gap:8px;">
      <button id="run" class="primary">Run</button>
      <button id="random">Random seed</button>
      <button id="reset">Defaults</button>
    </div>
  `;
  controls.id = 'shell-controls';

  const status = document.createElement('div');
  status.style.cssText = 'margin-bottom:12px; color:#6d7b8d; font-size:12.5px; min-height:18px';

  const stage = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.append(controls, status, stage);
  container.appendChild(wrapper);

  const $ = <T extends HTMLElement>(id: string): T => controls.querySelector<T>(`#${id}`)!;

  const seedInput = $<HTMLInputElement>('seed');
  const speedInput = $<HTMLInputElement>('speed');
  const playInput = $<HTMLInputElement>('play');
  const ballsInput = $<HTMLInputElement>('balls');
  const slotsInput = $<HTMLInputElement>('slots');

  let renderer: PlinkoRenderer | null = null;
  let frame = 0;
  /**
   * Read live inside the loop, so playback speed can be changed mid-drop.
   *
   * 1x is the chosen default: one sim tick per animation frame puts a drop at roughly
   * 10 seconds, which reads as dramatic rather than hurried. Higher values are for
   * iterating quickly, not for viewing.
   */
  let ticksPerFrame = 1;

  function syncLabels(): void {
    $('speedVal').textContent = Number(speedInput.value).toFixed(1);
    $('playVal').textContent = `${playInput.value}x`;
    $('ballsVal').textContent = ballsInput.value;
    $('slotsVal').textContent = slotsInput.value;
    ticksPerFrame = Number(playInput.value);
  }

  async function start(): Promise<void> {
    cancelAnimationFrame(frame);
    renderer?.destroy();
    stage.innerHTML = '';
    syncLabels();

    const run = createPlinkoRun({
      ...DEFAULT_PLINKO,
      board: { ...DEFAULT_BOARD, slotCount: Number(slotsInput.value) },
      seed: Number(seedInput.value),
      ballCount: Number(ballsInput.value),
      maxSpeed: Number(speedInput.value),
    });

    // Ball 0 stands in for "the member watching" until real league data exists.
    renderer = await createPlinkoRenderer(stage, run, 0);

    const started = performance.now();

    const loop = (): void => {
      // Playback speed is a presentation choice. The simulation always advances one
      // fixed tick at a time, so how many ticks we render per frame cannot change
      // where a single ball lands.
      for (let i = 0; i < ticksPerFrame && !run.done; i++) advance(run);

      renderer!.draw(run);

      if (run.done) {
        const seconds = (performance.now() - started) / 1000;
        const slots = run.landings.map((l) => l.slot).join(', ');
        status.innerHTML =
          `settled at tick <b class="val">${run.world.tick}</b> ` +
          `in <b class="val">${seconds.toFixed(1)}s</b> of viewing time ` +
          `&nbsp;·&nbsp; slots: <b class="val">${slots}</b>`;
      } else {
        status.textContent = `tick ${run.world.tick}`;
        frame = requestAnimationFrame(loop);
      }
    };

    loop();
  }

  for (const input of [speedInput, playInput, ballsInput, slotsInput]) {
    input.addEventListener('input', syncLabels);
  }

  $('run').addEventListener('click', () => void start());

  $('random').addEventListener('click', () => {
    // Deliberately uses Math.random: choosing WHICH seed to watch is a shell-layer
    // decision, not part of the simulation. The sim itself never sees it.
    seedInput.value = String(Math.floor(Math.random() * 1_000_000));
    void start();
  });

  $('reset').addEventListener('click', () => {
    seedInput.value = '4242';
    speedInput.value = String(DEFAULT_PLINKO.maxSpeed);
    playInput.value = '1';
    ballsInput.value = String(DEFAULT_PLINKO.ballCount);
    slotsInput.value = String(DEFAULT_BOARD.slotCount);
    void start();
  });

  void start();

  return () => {
    cancelAnimationFrame(frame);
    renderer?.destroy();
  };
}

/**
 * The four arenas the picker offers, by human name. `GRINDER_ARENA` is also
 * `ARENA_VARIANTS[0]` under the hood (see `arenas.ts`'s `GRINDER` alias) — it is listed
 * here from `arena.ts` directly rather than through the event variants, since it is named
 * in its own right regardless of the event. `Gauntlet` and `Crossfire` are only ever
 * exported as members of `ARENA_VARIANTS`, so they are read from there by index.
 */
const ARENA_OPTIONS: ReadonlyArray<{ id: string; label: string; arena: ArenaConfig }> = [
  { id: 'grinder', label: 'The Grinder', arena: GRINDER_ARENA },
  { id: 'proving', label: 'The Proving Ground', arena: PROVING_ARENA },
  { id: 'greybox', label: 'The Greybox', arena: DEFAULT_ARENA },
  { id: 'gauntlet', label: ARENA_VARIANT_NAMES[1]!, arena: ARENA_VARIANTS[1]! },
  { id: 'crossfire', label: ARENA_VARIANT_NAMES[2]!, arena: ARENA_VARIANTS[2]! },
];

/** Mounts the Arena view, running real Forge-assembled bots, into `container`. Returns a
 *  teardown. */
function mountArena(container: HTMLElement): () => void {
  const controls = document.createElement('div');
  controls.style.cssText = `
    display:flex; flex-wrap:wrap; gap:18px; align-items:flex-end; margin-bottom:14px;
    padding:14px 16px; background:#0d1119; border:1px solid #1a2230; border-radius:8px;
    max-width:720px; box-sizing:border-box;
  `;
  controls.innerHTML = `
    <label class="dial"><span>Seed</span>
      <input id="arenaSeed" type="number" value="4242">
    </label>

    <label class="dial"><span>Arena</span>
      <select id="arenaSelect">
        ${ARENA_OPTIONS.map((opt) => `<option value="${opt.id}">${opt.label}</option>`).join('\n')}
      </select>
    </label>

    <div style="display:flex; gap:8px;">
      <button id="arenaRun" class="primary">Run</button>
      <button id="arenaRandom">Random seed</button>
    </div>
  `;
  controls.id = 'arena-controls';

  const status = document.createElement('div');
  status.style.cssText = 'margin-bottom:12px; color:#6d7b8d; font-size:12.5px; min-height:18px';

  const stage = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.append(controls, status, stage);
  container.appendChild(wrapper);

  const seedInput = controls.querySelector<HTMLInputElement>('#arenaSeed')!;
  const arenaSelect = controls.querySelector<HTMLSelectElement>('#arenaSelect')!;
  const runButton = controls.querySelector<HTMLButtonElement>('#arenaRun')!;
  const randomButton = controls.querySelector<HTMLButtonElement>('#arenaRandom')!;

  // Default selection: The Grinder — see Task 2.
  arenaSelect.value = 'grinder';

  let arenaRenderer: ArenaRenderer | null = null;
  let arenaFrame = 0;

  function selectedArena(): ArenaConfig {
    const opt = ARENA_OPTIONS.find((o) => o.id === arenaSelect.value);
    return opt ? opt.arena : GRINDER_ARENA;
  }

  async function startArenaRun(seed: number): Promise<void> {
    cancelAnimationFrame(arenaFrame);
    arenaRenderer?.destroy();
    stage.innerHTML = '';

    // The entered seed drives the same Forge-board-then-match derivation a real event
    // uses (see `buildsForSeed`), so the ten bots here differ exactly as they do in a real
    // event, and the match itself runs on a sub-seed drawn alongside the builds rather
    // than the raw entered seed — see `buildsForSeed`'s own doc comment for why.
    const { builds, matchSeed } = buildsForSeed(seed, DEFAULT_MATCH.botCount);
    const match = createMatch({ ...DEFAULT_MATCH, arena: selectedArena(), seed: matchSeed, builds });
    const botTags = buildBotTags(match, builds);
    arenaRenderer = await createArenaRenderer(stage, match, 0, botTags);

    const loop = (): void => {
      // 1x: one simulation tick per animation frame, matching the Forge.
      if (!match.done) advanceMatch(match);

      arenaRenderer!.draw(match);
      const alive = match.bots.filter((b) => b.alive).length;

      if (match.done) {
        const winnerIndex = match.bots.findIndex((b) => b.alive);
        const winner = winnerIndex === -1 ? null : match.bots[winnerIndex]!;
        const winnerBuild = winnerIndex === -1 ? null : builds[winnerIndex];
        const winnerTag = winner ? match.aiStates.get(winner.body.id)?.personality : null;
        const winnerParts = winnerBuild ? ` [${winnerBuild.partLabels.chassis}/${winnerBuild.partLabels.armour}]` : '';
        status.textContent = winner
          ? `finished at tick ${match.world.tick} — bot #${winnerIndex + 1} (${winnerTag})${winnerParts} wins`
          : `finished at tick ${match.world.tick} — no survivors`;
      } else {
        status.textContent = `tick ${match.world.tick} — ${alive} alive`;
      }

      if (!match.done) arenaFrame = requestAnimationFrame(loop);
    };

    loop();
  }

  runButton.addEventListener('click', () => void startArenaRun(Number(seedInput.value)));

  randomButton.addEventListener('click', () => {
    seedInput.value = String(Math.floor(Math.random() * 1_000_000));
    void startArenaRun(Number(seedInput.value));
  });

  void startArenaRun(Number(seedInput.value));

  return () => {
    cancelAnimationFrame(arenaFrame);
    arenaRenderer?.destroy();
  };
}

// A small persistent stylesheet, kept outside `viewHost` so it survives view switches
// (unlike Forge's own <style> tag, which lives inside its controls and is torn down
// with it). It gives the nav buttons and the Arena's controls the same look as the
// Forge's dials and buttons, without touching Forge's own markup or styling.
const globalStyle = document.createElement('style');
globalStyle.textContent = `
  .dial { display:flex; flex-direction:column; gap:5px; }
  .dial > span:first-child {
    font-size:10px; letter-spacing:.11em; text-transform:uppercase; color:#5b6a80;
  }
  .dial input[type=range] { width:132px; accent-color:#4aa8ff; }
  .dial input[type=number], .dial select {
    width:104px; background:#141b26; color:#dbe4ef; border:1px solid #24303f;
    border-radius:4px; padding:5px 7px; font:inherit;
  }
  .dial select { width:172px; }
  .val { color:#dbe4ef; font-variant-numeric:tabular-nums; font-size:12.5px; }
  .note { color:#4d5a6b; font-size:11px; }
  #shell-controls button, .view-nav button, #arena-controls button {
    background:#1a2432; color:#9fb0c6; border:1px solid #26344a; border-radius:5px;
    padding:7px 14px; font:inherit; font-size:12.5px; cursor:pointer;
  }
  #shell-controls button:hover, .view-nav button:hover, #arena-controls button:hover {
    background:#22304a; color:#e2e9f2;
  }
  #shell-controls button.primary, .view-nav button.primary, #arena-controls button.primary {
    background:#1f3a5c; color:#9fd0ff; border-color:#2d5482;
  }
`;
document.head.appendChild(globalStyle);

const app = document.getElementById('app')!;

const nav = document.createElement('div');
nav.className = 'view-nav';
nav.style.cssText = 'display:flex; gap:8px; margin-bottom:14px;';
nav.innerHTML = `
  <button id="viewForge" class="primary">Bot Forge</button>
  <button id="viewArena">Arena</button>
`;

const viewHost = document.createElement('div');
app.append(nav, viewHost);

let teardown: (() => void) | null = null;

function show(view: 'forge' | 'arena'): void {
  teardown?.();
  teardown = null;
  viewHost.innerHTML = '';
  nav.querySelector('#viewForge')!.classList.toggle('primary', view === 'forge');
  nav.querySelector('#viewArena')!.classList.toggle('primary', view === 'arena');
  teardown = view === 'forge' ? mountForge(viewHost) : mountArena(viewHost);
}

nav.querySelector('#viewForge')!.addEventListener('click', () => show('forge'));
nav.querySelector('#viewArena')!.addEventListener('click', () => show('arena'));

show('forge');
