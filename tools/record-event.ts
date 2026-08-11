/**
 * Admin tool: rolls candidate events, previews one seed in full, and saves an official
 * record.
 *
 * Usage:
 *   npm run record -- [count]        Roll `count` random master seeds (default 5),
 *                                     run each event, and print a summary of each.
 *   npm run record -- --seed <n>     Preview one specific master seed in full: draft
 *                                     order and points, builds, battle lengths, every
 *                                     tiebreak and which rule settled it, and the
 *                                     checksum. Prints only -- nothing is saved.
 *   npm run record -- --save <seed>  Re-run one seed and write it to
 *                                     data/official-event.json as the official record.
 *
 * The workflow: roll a batch, preview the one that looks interesting with `--seed`, and
 * only then save it.
 *
 * Which seed to record is an editorial choice, not a simulation output, so this tool is
 * free to use Math.random() and Date — tools/ is exempt from the determinism contract
 * that governs src/sim/. `runEvent` itself is still fully deterministic; nothing here
 * changes what a given seed produces, only which seed gets looked at or written down.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { runEvent, type EventMember } from '../src/sim/event/event';
import { createRecord, verifyRecord } from '../src/sim/event/record';
import { CATEGORIES } from '../src/sim/parts/tables';
import { ROSTER, toEventMembers } from '../src/config/roster';

const DATA_DIR = join(process.cwd(), 'data');
const RECORD_PATH = join(DATA_DIR, 'official-event.json');

/**
 * A master seed must fit the 32-bit range `createRng` expects, and it must be exactly
 * reproducible from the number the owner typed -- see `parseMasterSeed`, which enforces
 * this same bound on every seed that reaches `runEvent` from the command line.
 */
export const MAX_MASTER_SEED = 2147483647;

/** The real ten-person league roster, in the shape `runEvent` needs. Every path through
 *  this tool -- the random-roll batch, the single-seed preview, and the official save --
 *  uses the same real roster, so a preview always shows the names that will actually be
 *  on screen. */
function loadRoster(): EventMember[] {
  return toEventMembers(ROSTER);
}

/**
 * Parses and validates a master seed typed on the command line.
 *
 * A silently-coerced seed -- 0, a negative, a fraction, `NaN` from a typo -- would still
 * run `runEvent` and print a real-looking event, but one that could never be reproduced
 * from the number the owner thought they used. So every invalid form is rejected here,
 * before `runEvent` ever sees the value, with a message that states the valid range.
 */
export function parseMasterSeed(raw: string): number {
  const seed = Number(raw);
  if (!Number.isInteger(seed) || seed < 1 || seed > MAX_MASTER_SEED) {
    throw new Error(`Invalid master seed "${raw}": must be a whole number between 1 and ${MAX_MASTER_SEED}.`);
  }
  return seed;
}

function formatSeconds(ticks: number): string {
  return `${(ticks / 60).toFixed(0)}s`;
}

/**
 * Prints one event in full: draft order with points, every member's build, battle
 * lengths with arena names, how many placements needed a tiebreak (and which rule
 * settled each one), and the checksum.
 *
 * Shared by the random-roll batch and the `--seed` single-seed preview -- a preview is
 * just a batch of one, read in the same shape. Nothing here can change what a seed
 * produces; it only reads off `runEvent`'s result and formats it.
 */
function summarize(members: EventMember[], seed: number): void {
  const result = runEvent({ masterSeed: seed, members });
  const byId = new Map(members.map((m) => [m.id, m]));
  const nameFor = (memberId: string): string => byId.get(memberId)?.name ?? memberId;

  const order = result.standings.map((s) => `${nameFor(s.memberId)} (${s.points} pts)`).join(' > ');
  const battleLengths = result.battles.map((b) => `${b.arenaName} ${formatSeconds(b.ticks)}`).join(', ');
  const tiebroken = result.standings.filter((s) => s.tiebreak !== null);

  console.log(`\n  seed ${seed}`);
  console.log(`    draft order:     ${order}`);
  console.log(`    battle lengths:  ${battleLengths}`);
  console.log(`    tiebreaks:       ${tiebroken.length} place(s) needed a tiebreak`);
  for (const standing of tiebroken) {
    console.log(
      `      draft position ${standing.draftPosition} (${nameFor(standing.memberId)}): settled by ${standing.tiebreak}`,
    );
  }
  console.log(`    builds:`);
  members.forEach((member, i) => {
    const labels = result.partLabels[i]!;
    const parts = CATEGORIES.map((category) => labels[category]).join(', ');
    console.log(`      ${member.name.padEnd(16)} ${parts}`);
  });
  console.log(`    checksum:        ${result.checksum}`);
}

function rollAndPreview(count: number): void {
  const members = loadRoster();
  console.log(`Rolling ${count} candidate event(s) for ${members.length} members...`);

  for (let i = 0; i < count; i++) {
    // +1 keeps every rolled seed inside the valid range (1..MAX_MASTER_SEED) that
    // `--seed` and `--save` enforce -- without it, `Math.random() * MAX_MASTER_SEED`
    // can floor to 0, a seed this same tool would then refuse to preview or save.
    const seed = Math.floor(Math.random() * MAX_MASTER_SEED) + 1;
    summarize(members, seed);
  }

  console.log(`\nLiked one? Preview it in full with: npm run record -- --seed <seed>`);
  console.log(`Then save it with: npm run record -- --save <seed>\n`);
}

/** Runs one specific master seed and prints it in full. Nothing is saved -- this is the
 *  look-before-you-commit step between rolling candidates and `--save`. Exported so a
 *  test can capture its `console.log` output and check the shape of a preview directly,
 *  the same way a human running `--seed` would read it. */
export function previewSeed(seed: number): void {
  const members = loadRoster();
  console.log(`Previewing seed ${seed} for ${members.length} members...`);
  summarize(members, seed);
  console.log(`\nLiked it? Save it with: npm run record -- --save ${seed}\n`);
}

function saveRecord(seed: number): void {
  const members = loadRoster();
  const record = createRecord({
    leagueId: 'default-league',
    label: `Official event - seed ${seed}`,
    masterSeed: seed,
    members,
    recordedAt: new Date().toISOString(),
  });

  mkdirSync(dirname(RECORD_PATH), { recursive: true });
  writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');

  const check = verifyRecord(record);
  console.log(`\nSaved ${RECORD_PATH}`);
  console.log(`  seed:      ${record.masterSeed}`);
  console.log(`  checksum:  ${record.checksum}`);
  console.log(`  verifies:  ${check.valid ? 'yes' : 'NO -- DO NOT SHIP THIS RECORD'}`);
  if (!check.valid) {
    console.log(`    expected ${check.expectedChecksum}, got ${check.actualChecksum}`);
    process.exitCode = 1;
  }
  console.log('');
}

/** Parses `args[1]` as a master seed for a flag that requires one (`--seed`, `--save`),
 *  printing the validation error plus a usage line and setting a failing exit code on
 *  rejection. Returns `undefined` on rejection so the caller can bail out. */
function requireSeedArg(args: string[], usage: string): number | undefined {
  try {
    return parseMasterSeed(args[1] ?? '');
  } catch (err) {
    console.error((err as Error).message);
    console.error(usage);
    process.exitCode = 1;
    return undefined;
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args[0] === '--seed') {
    const seed = requireSeedArg(args, 'Usage: npm run record -- --seed <n>');
    if (seed === undefined) return;
    previewSeed(seed);
    return;
  }

  if (args[0] === '--save') {
    const seed = requireSeedArg(args, 'Usage: npm run record -- --save <seed>');
    if (seed === undefined) return;
    saveRecord(seed);
    return;
  }

  const count = Number(args[0] ?? 5);
  if (!Number.isFinite(count) || count <= 0) {
    console.error('Usage: npm run record -- [count]');
    process.exitCode = 1;
    return;
  }
  rollAndPreview(count);
}

// Guarded so importing this module from a test (e.g. to exercise `parseMasterSeed`)
// never runs the CLI: Vitest sets `process.env.VITEST` for the whole test process, but
// running this file directly via `vite-node` never sets it.
if (process.env.VITEST === undefined) {
  main();
}
