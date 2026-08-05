/**
 * Admin tool: rolls candidate events, previews them, and saves an official record.
 *
 * Usage:
 *   npm run record -- [count]        Roll `count` random master seeds (default 5),
 *                                     run each event, and print a summary of each.
 *   npm run record -- --save <seed>  Re-run one seed and write it to
 *                                     data/official-event.json as the official record.
 *
 * The workflow: roll a batch, read the summaries, pick an event you like, save it.
 *
 * Which seed to record is an editorial choice, not a simulation output, so this tool is
 * free to use Math.random() and Date — tools/ is exempt from the determinism contract
 * that governs src/sim/. `runEvent` itself is still fully deterministic; nothing here
 * changes what a given seed produces, only which seed gets written down.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { runEvent, type EventMember } from '../src/sim/event/event';
import { createRecord, verifyRecord } from '../src/sim/event/record';

const DATA_DIR = join(process.cwd(), 'data');
const LEAGUE_PATH = join(DATA_DIR, 'league.json');
const RECORD_PATH = join(DATA_DIR, 'official-event.json');

/** A master seed must fit the 32-bit range `createRng` expects. */
const MAX_MASTER_SEED = 2147483647;

function loadRoster(): EventMember[] {
  if (!existsSync(LEAGUE_PATH)) {
    throw new Error(`No roster found at ${LEAGUE_PATH}. Expected an array of {id, name, colour}.`);
  }
  const raw = readFileSync(LEAGUE_PATH, 'utf-8');
  return JSON.parse(raw) as EventMember[];
}

function formatSeconds(ticks: number): string {
  return `${(ticks / 60).toFixed(0)}s`;
}

function summarize(members: EventMember[], seed: number): void {
  const result = runEvent({ masterSeed: seed, members });
  const byId = new Map(members.map((m) => [m.id, m]));

  const order = result.standings.map((s) => byId.get(s.memberId)?.name ?? s.memberId).join(' > ');
  const battleLengths = result.battles.map((b) => formatSeconds(b.ticks)).join(', ');
  const tiebreaks = result.standings.filter((s) => s.tiebreak !== null).length;

  console.log(`\n  seed ${seed}`);
  console.log(`    draft order:     ${order}`);
  console.log(`    battle lengths:  ${battleLengths}`);
  console.log(`    tiebreaks:       ${tiebreaks} place(s) needed a tiebreak`);
}

function rollAndPreview(count: number): void {
  const members = loadRoster();
  console.log(`Rolling ${count} candidate event(s) for ${members.length} members...`);

  for (let i = 0; i < count; i++) {
    const seed = Math.floor(Math.random() * MAX_MASTER_SEED);
    summarize(members, seed);
  }

  console.log(`\nLiked one? Save it with: npm run record -- --save <seed>\n`);
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

function main(): void {
  const args = process.argv.slice(2);

  if (args[0] === '--save') {
    const seed = Number(args[1]);
    if (!Number.isFinite(seed)) {
      console.error('Usage: npm run record -- --save <seed>');
      process.exitCode = 1;
      return;
    }
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

main();
