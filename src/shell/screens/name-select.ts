import { ROSTER } from '../../config/roster';
import { readableInkFor } from '../colour';
import { nextBeat } from '../beats';
import { claimMember } from '../progress';
import type { Screen, ScreenContext } from './types';

/** A small check-mark, drawn rather than an emoji glyph — see the roster tile's
 *  selected state below. */
const CHECK_ICON = `
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M4 10.5l4 4 8-8.5" fill="none" stroke="currentColor" stroke-width="2.4"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

/** First name only, for the compact "Continue as ___" label. */
function firstName(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

/**
 * Beat 2 — Name select. Ten members, each in their own colour. Picking one claims them
 * and advances. A viewer resuming with a member already claimed sees a "welcome back"
 * banner and can continue as that member, or pick someone else from the same grid — see
 * `docs/superpowers/specs/2026-08-11-website-design.md` §2 and §3.
 */
export const nameSelectScreen: Screen = {
  render(ctx: ScreenContext) {
    const root = document.createElement('section');
    root.className = 'screen screen-name-select';

    const header = document.createElement('div');
    header.className = 'name-select-header';
    header.innerHTML = `
      <h1>Who's watching?</h1>
      <p class="name-select-copy">Pick your name. You'll follow your own bot through everything that follows.</p>
    `;
    root.appendChild(header);

    const claimedId = ctx.state.claimedMemberId;
    const claimedMember = claimedId ? (ROSTER.find((m) => m.id === claimedId) ?? null) : null;

    if (claimedMember) {
      const banner = document.createElement('div');
      banner.className = 'resume-banner';
      banner.style.setProperty('--member-colour', claimedMember.colour);
      banner.innerHTML = `
        <span class="resume-banner__text">
          Welcome back — you were watching as <strong>${claimedMember.name}</strong>.
        </span>
      `;
      const continueButton = document.createElement('button');
      continueButton.type = 'button';
      continueButton.className = 'btn btn-primary';
      continueButton.dataset.role = 'continue';
      continueButton.textContent = `Continue as ${firstName(claimedMember.name)}`;
      continueButton.addEventListener('click', () => {
        ctx.navigate(nextBeat('name-select')!);
      });
      banner.appendChild(continueButton);
      root.appendChild(banner);
    }

    const grid = document.createElement('div');
    grid.className = 'roster-grid';
    grid.setAttribute('role', 'list');

    for (const member of ROSTER) {
      const isSelected = member.id === claimedId;

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'roster-tile';
      if (isSelected) tile.classList.add('roster-tile--selected');
      tile.setAttribute('role', 'listitem');
      tile.setAttribute('aria-pressed', String(isSelected));
      tile.dataset.memberId = member.id;
      tile.style.setProperty('--member-colour', member.colour);

      tile.innerHTML = `
        <span class="roster-tile__badge" style="background:${member.colour}; color:${readableInkFor(member.colour)}">
          ${member.initials}
        </span>
        <span class="roster-tile__name">${member.name}</span>
        <span class="roster-tile__check">${CHECK_ICON}</span>
      `;

      tile.addEventListener('click', () => {
        claimMember(ctx.seed, member.id, ctx.storage ?? undefined);
        ctx.navigate(nextBeat('name-select')!);
      });

      grid.appendChild(tile);
    }

    root.appendChild(grid);
    ctx.container.appendChild(root);
  },
};
