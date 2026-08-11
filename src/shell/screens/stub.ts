import { categoryForBeat, nextBeat, type BeatId } from '../beats';
import { resetWatch } from '../progress';
import type { Screen, ScreenContext } from './types';

/** A readable label for a beat that has no real screen yet. Forge beats read off the
 *  category they show (kept in sync with `CATEGORIES` via `categoryForBeat`, never
 *  hardcoded); everything else is derived from the beat id itself. */
function humanize(beat: BeatId): string {
  const category = categoryForBeat(beat);
  if (category) {
    return `The Forge — ${category.charAt(0).toUpperCase()}${category.slice(1)}`;
  }
  return beat
    .split('-')
    .map((word) => (/^\d+$/.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ');
}

/**
 * Placeholder for every beat past `what-to-expect` — none of the real screens (the
 * Forge boards, the battles, the standings, the draft order) are built yet. Renders the
 * beat's name and a way to keep moving, so the router and progress machinery can be
 * exercised end to end before the real screens exist.
 */
export function stubScreen(beat: BeatId): Screen {
  return {
    render(ctx: ScreenContext) {
      const root = document.createElement('section');
      root.className = 'screen screen-stub';
      root.innerHTML = `
        <div class="stub-card">
          <h1>${humanize(beat)}</h1>
          <p class="stub-copy">Placeholder — this beat isn't built yet.</p>
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'stub-actions';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-primary';

      const next = nextBeat(beat);
      if (next) {
        button.textContent = 'Continue';
        button.addEventListener('click', () => ctx.navigate(next));
      } else {
        button.textContent = 'Watch again';
        button.addEventListener('click', () => {
          resetWatch(ctx.seed, ctx.storage ?? undefined);
          ctx.navigate('landing');
        });
      }

      actions.appendChild(button);
      root.appendChild(actions);
      ctx.container.appendChild(root);
    },
  };
}
