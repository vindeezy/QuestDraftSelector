import { DEFAULT_BOARD } from '../sim/plinko/board';
import { DEFAULT_PLINKO, advance, createPlinkoRun } from '../sim/plinko/plinko';
import { createPlinkoRenderer, type PlinkoRenderer } from '../render/plinko-renderer';

const app = document.getElementById('app')!;

const controls = document.createElement('div');
controls.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:12px';
controls.innerHTML = `
  <label>Seed <input id="seed" type="number" value="4242" style="width:110px"></label>
  <button id="run">Run</button>
  <button id="random">Random seed</button>
  <span id="status" style="color:#5d6b81"></span>
`;

const stage = document.createElement('div');
const wrapper = document.createElement('div');
wrapper.append(controls, stage);
app.appendChild(wrapper);

const seedInput = controls.querySelector<HTMLInputElement>('#seed')!;
const status = controls.querySelector<HTMLSpanElement>('#status')!;

let renderer: PlinkoRenderer | null = null;
let frame = 0;

async function start(seed: number): Promise<void> {
  cancelAnimationFrame(frame);
  renderer?.destroy();
  stage.innerHTML = '';

  const run = createPlinkoRun({ ...DEFAULT_PLINKO, board: DEFAULT_BOARD, seed });
  // Ball 0 stands in for "the member watching" until real league data exists.
  renderer = await createPlinkoRenderer(stage, run, 0);

  const loop = (): void => {
    // The sim runs at a fixed rate regardless of display refresh. Two ticks per
    // frame is a playback speed choice and has no effect on the outcome.
    for (let i = 0; i < 2 && !run.done; i++) advance(run);

    renderer!.draw(run);
    status.textContent = run.done
      ? `settled at tick ${run.world.tick} — slots: ${run.landings.map((l) => l.slot).join(', ')}`
      : `tick ${run.world.tick}`;

    if (!run.done) frame = requestAnimationFrame(loop);
  };

  loop();
}

controls.querySelector('#run')!.addEventListener('click', () => {
  void start(Number(seedInput.value));
});

controls.querySelector('#random')!.addEventListener('click', () => {
  // Deliberately uses Math.random: choosing WHICH seed to watch is a shell-layer
  // decision, not part of the simulation. The sim itself never sees it.
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  void start(Number(seedInput.value));
});

void start(Number(seedInput.value));
