import { ensureAudioResumed } from '../audio';
import type { Screen, ScreenContext } from './types';

/**
 * Beat 1 — Landing. Title, tone, one button.
 *
 * The Begin button does two things: it advances to `name-select`, and it is the user
 * gesture that creates and resumes the shared `AudioContext` (see `audio.ts`'s doc
 * comment for why it has to happen here, before anything actually needs to make sound).
 */
export const landingScreen: Screen = {
  render(ctx: ScreenContext) {
    const root = document.createElement('section');
    root.className = 'screen screen-landing';
    root.innerHTML = `
      <div class="landing-glow" aria-hidden="true"></div>
      <div class="landing-content">
        <h1 class="landing-title">Draft by Combat</h1>
        <p class="landing-tagline">
          Ten robots fight it out. Whoever's left standing decides who picks first.
        </p>
        <button type="button" class="btn btn-primary btn-large" data-role="begin">Begin</button>
      </div>
    `;

    const begin = root.querySelector<HTMLButtonElement>('[data-role="begin"]')!;
    begin.addEventListener('click', () => {
      void ensureAudioResumed();
      ctx.navigate('name-select');
    });

    ctx.container.appendChild(root);
  },
};
