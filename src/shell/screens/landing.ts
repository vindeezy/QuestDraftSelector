import { ensureAudioResumed } from '../audio';
import { mountSmokeCanvas } from '../vfx/smoke-canvas';
import type { Screen, ScreenContext } from './types';

/**
 * Beat 1 — Landing. Title, tone, one button.
 *
 * The Begin button does two things: it advances to `name-select`, and it is the user
 * gesture that creates and resumes the shared `AudioContext` (see `audio.ts`'s doc
 * comment for why it has to happen here, before anything actually needs to make sound).
 *
 * The smoke behind it is the one place on the site that spends frames on nothing but
 * atmosphere. It earns them here and nowhere else: this is the screen a member sits on while
 * the rest of the league catches up, and the only one with nothing else to look at.
 *
 * Order in the DOM is deliberate — smoke, then scrim, then glow, then content. Each layer has
 * to sit over the one before it, and none of them are positioned by z-index, so the source
 * order IS the stack.
 */
export const landingScreen: Screen = {
  render(ctx: ScreenContext) {
    const root = document.createElement('section');
    root.className = 'screen screen-landing';
    root.innerHTML = `
      <div class="landing-scrim" aria-hidden="true"></div>
      <div class="landing-glow" aria-hidden="true"></div>
      <div class="landing-content">
        <h1 class="landing-title">Draft by Combat</h1>
        <p class="landing-tagline">
          Ten robots fight it out. Whoever's left standing decides who picks first.
        </p>
        <button type="button" class="btn btn-primary btn-large btn-heartbeat" data-role="begin">Begin</button>
      </div>
    `;

    const begin = root.querySelector<HTMLButtonElement>('[data-role="begin"]')!;
    begin.addEventListener('click', () => {
      void ensureAudioResumed();
      ctx.navigate('name-select');
    });

    ctx.container.appendChild(root);

    // Mounted after the append, not before: the canvas sizes itself off the host's measured
    // box, and an element still detached from the document measures 0×0.
    const smoke = mountSmokeCanvas(root);

    // The first screen with a teardown. Without it the frame loop outlives the screen, and a
    // viewer walking the whole site would leave one running per visit to the landing.
    return () => {
      smoke.destroy();
    };
  },
};
