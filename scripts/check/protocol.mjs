#!/usr/bin/env node
// Peer protocol guard: a change to the wire format must raise PEER_PROTOCOL_VERSION to exactly one
// above the target branch (main), and a raised version must never reuse the target's number.
//   node scripts/check/protocol.mjs [--base <ref>] [--allow-unbumped-wire]
// Runs in check:release (against the working tree) and in ff-main (branch tip against main).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROTOCOL_PATH = 'src/network/peer/protocol.ts';
/** Files whose change is a wire change: snapshot/packet codecs and the required bootstrap slices. */
export const WIRE = [/^src\/network\/(?:.+\/)?[^/]*Codec\.ts$/iu, /^src\/network\/FullGameStateBootstrap\.ts$/u];
/** Other network files: often wire-relevant (slice keys, message fields), often not. Warn only. */
export const MAYBE_WIRE = [/^src\/network\//u];

const VERSION = /export const PEER_PROTOCOL_VERSION = (\d+);/u;
export function parseVersion(source, where) {
  const match = VERSION.exec(source ?? '');
  if (!match) throw Error(`PEER_PROTOCOL_VERSION not found in ${PROTOCOL_PATH} at ${where}`);
  return Number(match[1]);
}
/** protocol.ts minus comments and the version line: what remains are the message types themselves. */
const messageTypes = source => source.replace(/\/\*[\s\S]*?\*\//gu, '').split('\n')
  .filter(line => !/^\s*\/\//u.test(line) && !VERSION.test(line)).map(line => line.trim()).filter(Boolean).join('\n');

/**
 * read(ref) returns a file's content at a git ref (or null when missing); readHead(path) returns the head
 * side (working tree or branch tip). changed is the head's changed path list against the merge base.
 */
export function evaluateProtocol({ targetLabel, read, readHead, mergeBase, changed, allowUnbumpedWire = false }) {
  const target = parseVersion(read('target', PROTOCOL_PATH), targetLabel);
  const head = parseVersion(readHead(PROTOCOL_PATH), 'head');
  const wire = changed.filter(path => WIRE.some(pattern => pattern.test(path)));
  if (changed.includes(PROTOCOL_PATH)
    && messageTypes(read(mergeBase, PROTOCOL_PATH) ?? '') !== messageTypes(readHead(PROTOCOL_PATH) ?? '')) wire.push(PROTOCOL_PATH);
  const maybe = changed.filter(path => !wire.includes(path) && path !== PROTOCOL_PATH && MAYBE_WIRE.some(p => p.test(path)));
  const list = paths => `${paths.slice(0, 4).join(', ')}${paths.length > 4 ? ` +${paths.length - 4}` : ''}`;
  const errors = [], notes = [];
  if (head < target) errors.push(`PEER_PROTOCOL_VERSION ${head} is below ${targetLabel} (${target}): merge ${targetLabel} first.`);
  else if (head > target + 1) errors.push(`PEER_PROTOCOL_VERSION ${head} skips numbers: ${targetLabel} is ${target}, use ${target + 1}.`);
  else if (head === target + 1) notes.push(`protocol ${head} = ${targetLabel} ${target} + 1${wire.length ? ` (wire: ${list(wire)})` : ''}`);
  else if (wire.length && !allowUnbumpedWire) {
    errors.push(`wire format changed (${list(wire)}) but PEER_PROTOCOL_VERSION is still ${head}, the same as ${targetLabel}. `
      + `Set it to ${target + 1} and extend the comment above it. If ${targetLabel} raised it to ${head} for another change `
      + `after this branch had raised it too, the number is taken: use ${target + 1}. `
      + `A provably format-neutral change may pass --allow-unbumped-wire.`);
  } else if (wire.length) notes.push(`wire files changed without a bump (--allow-unbumped-wire): ${list(wire)}`);
  else if (maybe.length) notes.push(`network files changed (${list(maybe)}); protocol stays ${head}. Raise it to ${target + 1} if a message, slice key or field changed.`);
  else notes.push(`no wire change; protocol stays ${head}`);
  return { ok: errors.length === 0, errors, notes, target, head, wire, maybe };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { changedFiles, resolveBase, root } = await import('./changes.mjs');
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') i++;
    else if (argv[i] !== '--allow-unbumped-wire' && !argv[i].startsWith('--base=')) throw Error(`Unknown flag ${argv[i]}`);
  }
  const base = resolveBase(argv);
  const show = (ref, path) => {
    try { return execFileSync('git', ['-C', root, 'show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return null; }
  };
  const result = evaluateProtocol({
    targetLabel: base.ref, mergeBase: base.mergeBase, changed: changedFiles(base.mergeBase),
    read: (ref, path) => show(ref === 'target' ? base.ref : ref, path),
    readHead: path => readFileSync(join(root, path), 'utf8'),
    allowUnbumpedWire: argv.includes('--allow-unbumped-wire'),
  });
  for (const note of result.notes) console.log(`protocol: ${note}`);
  for (const error of result.errors) console.error(`✗ protocol: ${error}`);
  process.exitCode = result.ok ? 0 : 1;
}
