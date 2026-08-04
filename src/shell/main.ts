import { DEFAULT_BOARD } from '../sim/plinko/board';
import { DEFAULT_PLINKO, advance, createPlinkoRun } from '../sim/plinko/plinko';
import { createPlinkoRenderer, type PlinkoRenderer } from '../render/plinko-renderer';

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

const app = document.getElementById('app')!;

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

  <label class="dial"><span>Playback <b class="val" id="playVal">2x</b></span>
    <input id="play" type="range" min="1" max="6" step="1" value="2">
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
app.appendChild(wrapper);

const $ = <T extends HTMLElement>(id: string): T => controls.querySelector<T>(`#${id}`)!;

const seedInput = $<HTMLInputElement>('seed');
const speedInput = $<HTMLInputElement>('speed');
const playInput = $<HTMLInputElement>('play');
const ballsInput = $<HTMLInputElement>('balls');
const slotsInput = $<HTMLInputElement>('slots');

let renderer: PlinkoRenderer | null = null;
let frame = 0;
/** Read live inside the loop, so playback speed can be changed mid-drop. */
let ticksPerFrame = 2;

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
  playInput.value = '2';
  ballsInput.value = String(DEFAULT_PLINKO.ballCount);
  slotsInput.value = String(DEFAULT_BOARD.slotCount);
  void start();
});

void start();
