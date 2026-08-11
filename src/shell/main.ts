import './shell.css';
import { boot } from './boot';

/**
 * The site's entry point. Replaces the old Forge/Arena dev workbench (its job — letting
 * the sim and render layers be felt before the shell existed — is done). See
 * `docs/superpowers/specs/2026-08-11-website-design.md` for what this boots into.
 */

const app = document.getElementById('app');
if (!app) {
  throw new Error('main: expected an element with id "app" in index.html.');
}

void boot(app);
