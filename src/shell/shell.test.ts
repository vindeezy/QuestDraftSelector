import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'shell.css'), 'utf8');
const html = readFileSync(join(HERE, '..', '..', 'index.html'), 'utf8');

describe('the page background, which lives in two files', () => {
  it('keeps the anti-flash colour in index.html equal to --bg-0', () => {
    // The bug this exists for, and it was visible rather than theoretical. `index.html`
    // carries an inline background so the page is not white before `shell.css` arrives. It
    // is a DUPLICATE of `--bg-0`, and when the palette moved to charcoal this copy stayed on
    // the old near-black.
    //
    // That matters more than a normal stale colour, because a background on the ROOT element
    // propagates to the canvas and paints the entire scrollable page, while `body` is only
    // ever one viewport tall. The mismatch drew a hard horizontal seam at exactly 100vh on
    // every screen long enough to scroll.
    const token = /--bg-0:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1]?.toLowerCase();
    const inline = /html\s*\{\s*background:\s*(#[0-9a-fA-F]{6})/.exec(html)?.[1]?.toLowerCase();

    expect(token, 'could not read --bg-0 from shell.css').toBeDefined();
    expect(inline, 'could not read the inline background from index.html').toBeDefined();
    expect(inline).toBe(token);
  });

  it('sets that background on html only, so body cannot paint a shorter box over it', () => {
    // Setting it on `body` as well is what made the seam possible: two elements, two
    // different heights, one colour each. The root alone propagates and covers everything.
    expect(html).not.toMatch(/html\s*,\s*body\s*\{\s*background/);
  });
});
