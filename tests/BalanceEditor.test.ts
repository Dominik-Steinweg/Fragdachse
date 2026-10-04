import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { BalanceConflict, BalanceFileStore } from '../tools/balance-editor/server/BalanceFileStore';
import * as content from '../tools/balance-editor/shared/content';
import { LOADOUT_DIRECTORY, RULE_FILES, UPGRADE_FILE } from '../tools/balance-editor/shared/types';
import { at, set, type JsonObject } from '../tools/map-editor/shared/json';
import { updateJsonText } from '../tools/map-editor/server/jsonText';
import { BalanceSession } from '../tools/balance-editor/client/BalanceSession';
import { buildFamilies, effectGroups, isPrimaryField } from '../tools/balance-editor/shared/presentation';

const temporaryRoot = resolve('build/balance-editor-tests');
const temporary: string[] = [];
async function fixture(replace?: ConstructorParameters<typeof BalanceFileStore>[2]) {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(resolve(temporaryRoot, 'content-')); temporary.push(root);
  const keys = [...(await readdir(LOADOUT_DIRECTORY)).filter(f => f.endsWith('.json')).map(f => `${LOADOUT_DIRECTORY}/${f}`), UPGRADE_FILE, ...RULE_FILES];
  for (const key of keys) { await mkdir(dirname(resolve(root, key)), { recursive: true }); await writeFile(resolve(root, key), await readFile(key)); }
  return { root, store: new BalanceFileStore(root, async () => content, replace), keys };
}
afterEach(async () => {
  for (const root of temporary.splice(0)) {
    if (dirname(root) !== temporaryRoot) throw Error('Unexpected fixture path');
    await rm(root, { recursive: true, force: true });
  }
});

describe('Balance editor authored file boundary', () => {
  it('keeps every entry reachable and groups upgrade descendants with their item or general root', async () => {
    const { store } = await fixture(), workspace = await store.load(), families = buildFamilies(workspace);
    const all = families.flatMap(f => [...(f.base ? [f.base] : []), ...f.upgrades, ...f.related]);
    expect(all.map(e => e.key).sort()).toEqual(workspace.entries.map(e => e.key).sort());
    for (const family of families) for (const upgrade of family.upgrades) {
      const parent = upgrade.upgrade!.requires[0];
      if (parent) expect(family.upgrades.some(e => e.id === parent.upgradeId)).toBe(true);
      if (upgrade.upgrade!.itemId) expect(family.base?.id).toBe(upgrade.upgrade!.itemId);
    }
    const health = families.find(f => f.upgrades.some(e => e.id === 'hp'))!;
    expect(health.upgrades.map(e => e.id)).toEqual(expect.arrayContaining(['hp_regeneration', 'life_leech']));
    const glock = families.find(f => f.base?.id === 'GLOCK')!;
    expect(glock.upgrades.some(e => e.id === 'glock_burning_bullets')).toBe(true);
    const mg = families.find(f => f.upgrades.some(e => e.id === 'unlock_machine_gun_turret'))!;
    expect(mg.related.some(e => e.id === 'mgTurret.json')).toBe(true);
  });
  it('prioritizes combat tuning over presentation and keeps multi-effect targets together', async () => {
    const { store } = await fixture(), workspace = await store.load();
    const weapon = workspace.entries.find(e => e.key === 'weapon:GLOCK')!;
    expect(isPrimaryField(weapon, weapon.fields.find(f => f.label === 'damage')!)).toBe(true);
    expect(isPrimaryField(weapon, weapon.fields.find(f => f.label === 'projectileColor')!)).toBe(false);
    expect(weapon.fields.find(f => f.label === 'burnOnHit.damagePerTick')!.context).toContain('BURN_TICK_INTERVAL_MS');
    for (const entry of workspace.entries) for (const field of entry.fields) {
      if (entry.kind === 'weapon' && ['adrenalinGain', 'adrenalinCost'].includes(field.label)) {
        const slot = field.label === 'adrenalinGain' ? 'weapon1' : 'weapon2';
        expect(isPrimaryField(entry, field)).toBe(entry.fields.some(f => f.label.startsWith('allowedSlots.') && f.value === slot));
      }
      if (entry.kind === 'upgrade' && ['costPerLevel', 'bossPointCostPerLevel'].includes(field.label)) expect(isPrimaryField(entry, field)).toBe(false);
      if (['rageRequired', 'rageCost', 'rageDrainDuration'].includes(field.label)) expect(isPrimaryField(entry, field)).toBe(true);
      if (entry.kind !== 'upgrade' && /(?:tickInterval(?:Ms)?|bleedTickMs)$/i.test(field.label)) expect(isPrimaryField(entry, field)).toBe(true);
    }
    const upgrade = workspace.entries.find(e => e.id === 'glock_burning_bullets')!;
    const effects = effectGroups(upgrade);
    expect(effects.length).toBeGreaterThan(1);
    for (const effect of effects) {
      expect(effect.fields.map(f => f.label)).toEqual(expect.arrayContaining([
        `effects.${effect.index}.stat`, `effects.${effect.index}.mode`, `effects.${effect.index}.value`,
      ]));
      expect(effect.stat).toBe(effect.fields.find(f => f.label.endsWith('.stat'))!.value);
    }
  });
  it('lists every loadout and upgrade, and roundtrips every file byte-identically', async () => {
    const { root, store, keys } = await fixture();
    const workspace = await store.load();
    for (const file of workspace.files) {
      const original = await readFile(resolve(root, file.key));
      await store.save(file.key, file.revision, structuredClone(file.document));
      expect(await readFile(resolve(root, file.key))).toEqual(original);
    }
    const expectedIds = workspace.files.flatMap(f => ['weapons', 'utilities', 'ultimates'].flatMap(group => Object.keys(f.document[group] ?? {})));
    expect(workspace.entries.filter(e => ['weapon', 'utility', 'ultimate'].includes(e.kind)).map(e => e.id).sort()).toEqual(expectedIds.sort());
    const raw = JSON.parse(await readFile(resolve(root, UPGRADE_FILE), 'utf8'));
    expect(workspace.entries.filter(e => e.kind === 'upgrade').map(e => e.id).sort()).toEqual(raw.categories.flatMap((c: { upgrades: { id: string }[] }) => c.upgrades.map(u => u.id)).sort());
    expect(workspace.files.map(f => f.key).sort()).toEqual(keys.sort());
  }, 20_000); // Full on-disk roundtrip competes with the complete suite for filesystem/CPU time.
  it('changes only the requested token and the game loader receives the new value', async () => {
    const { root, store } = await fixture();
    const workspace = await store.load(), entry = workspace.entries.find(e => e.key === 'weapon:GLOCK')!;
    const field = entry.fields.find(f => f.label === 'damage')!, file = workspace.files.find(f => f.key === entry.file)!;
    const original = await readFile(resolve(root, entry.file), 'utf8');
    const draft = structuredClone(file.document); set(draft, field.path, Number(field.value) + 1);
    await store.save(file.key, file.revision, draft);
    expect(await readFile(resolve(root, entry.file), 'utf8')).toBe(original.replace(/("damage":\s*)[\d.]+/, `$1${Number(field.value) + 1}`));
    expect((await store.load()).entries.find(e => e.key === entry.key)!.fields.find(f => f.label === 'damage')!.value).toBe(Number(field.value) + 1);
  });
  it('preserves BOM, CRLF, compact arrays, number spellings and final newline', () => {
    const text = '\uFEFF{\r\n  "x": 1e2, "list": [2, 3.00], "other": { "q": "\\u00e4" }\r\n}\r\n';
    const document = JSON.parse(text.slice(1));
    expect(updateJsonText(text, document)).toBe(text);
    document.list[0] = 4;
    expect(updateJsonText(text, document)).toBe(text.replace('[2, 3.00]', '[4, 3.00]'));
  });
  it('rejects invalid values, type changes, unknown paths and structure edits without writing', async () => {
    const { root, store } = await fixture();
    const workspace = await store.load(), entry = workspace.entries.find(e => e.key === 'weapon:GLOCK')!;
    const file = workspace.files.find(f => f.key === entry.file)!, original = await readFile(resolve(root, file.key));
    for (const value of [-1, '9', null]) {
      const draft = structuredClone(file.document); set(draft, [...entry.path, 'damage'], value);
      await expect(store.save(file.key, file.revision, draft)).rejects.toThrow();
    }
    const renamed = structuredClone(file.document); set(renamed, [...entry.path, 'id'], 'OTHER');
    await expect(store.save(file.key, file.revision, renamed)).rejects.toThrow(/Balance-Felder/);
    await expect(store.save('../config.json', file.revision, file.document)).rejects.toThrow(/Unbekannte/);
    expect(await readFile(resolve(root, file.key))).toEqual(original);
  });
  it('uses upgrade normalization and cross-content modifier rules before writing', async () => {
    const { store } = await fixture(), workspace = await store.load();
    const entry = workspace.entries.find(e => e.key === 'upgrade:hp')!, file = workspace.files.find(f => f.key === UPGRADE_FILE)!;
    for (const value of [-1, 1.5]) {
      const draft = structuredClone(file.document); set(draft, [...entry.path, 'costPerLevel'], value);
      await expect(store.save(file.key, file.revision, draft)).rejects.toThrow(/normalisiert/);
    }
    const addOnly = workspace.entries.find(e => e.kind === 'upgrade' && e.fields.some(f => f.value === 'utility.DECOY.refundRadius'))!;
    const draft = structuredClone(file.document); set(draft, [...addOnly.path, 'effects', 0, 'mode'], 'add_percent_per_level');
    await expect(store.save(file.key, file.revision, draft)).rejects.toThrow(/nicht erlaubt/);
  });
  it('edits an inherited value with a minimal override and supports undo/redo across save', async () => {
    const { store } = await fixture(), workspace = await store.load();
    const entry = workspace.entries.find(e => e.baseId && e.fields.some(f => f.inherited && f.label === 'cooldown'))!;
    const field = entry.fields.find(f => f.label === 'cooldown')!, session = new BalanceSession(workspace);
    const value = Number(field.value) + 1; session.edit(entry, field, value);
    expect(session.dirtyFiles).toEqual([entry.file]);
    content.assertSupportedEdit(workspace, entry.file, session.document(entry.file));
    const file = workspace.files.find(f => f.key === entry.file)!;
    session.accept(entry.file, await store.save(entry.file, file.revision, session.document(entry.file)));
    expect(session.dirtyFiles).toEqual([]);
    session.undo(); expect(at(session.document(entry.file), field.path)).toBeUndefined(); expect(session.dirtyFiles).toEqual([entry.file]);
    session.redo(); expect(session.dirtyFiles).toEqual([]);
    session.undo();
    const savedFile = session.workspace.files.find(f => f.key === entry.file)!;
    await expect(store.save(entry.file, savedFile.revision, session.document(entry.file))).resolves.toBeDefined();
  });
  it('never overwrites an external edit or a second save based on an old revision', async () => {
    const { root, store } = await fixture(), workspace = await store.load();
    const entry = workspace.entries.find(e => e.key === 'weapon:GLOCK')!, file = workspace.files.find(f => f.key === entry.file)!;
    const draft = structuredClone(file.document); set(draft, [...entry.path, 'damage'], 11);
    const results = await Promise.allSettled([store.save(file.key, file.revision, draft), store.save(file.key, file.revision, draft)]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    const now = await store.load(), savedFile = now.files.find(f => f.key === file.key)!;
    await writeFile(resolve(root, file.key), (await readFile(resolve(root, file.key), 'utf8')) + '\n');
    await expect(store.save(file.key, savedFile.revision, file.document)).rejects.toBeInstanceOf(BalanceConflict);
  });
  it('leaves the original intact and removes temporary files if replacement fails', async () => {
    const { root, store } = await fixture(async () => { throw Error('disk failure'); });
    const workspace = await store.load(), entry = workspace.entries.find(e => e.key === 'weapon:GLOCK')!;
    const file = workspace.files.find(f => f.key === entry.file)!, original = await readFile(resolve(root, file.key));
    const draft: JsonObject = structuredClone(file.document); set(draft, [...entry.path, 'damage'], 11);
    await expect(store.save(file.key, file.revision, draft)).rejects.toThrow('disk failure');
    expect(await readFile(resolve(root, file.key))).toEqual(original);
    expect((await readdir(resolve(root, LOADOUT_DIRECTORY))).some(f => f.endsWith('.tmp'))).toBe(false);
  });
  it('detects a file change between the initial revision read and loading the content set', async () => {
    const { root, store } = await fixture(), workspace = await store.load();
    const entry = workspace.entries.find(e => e.key === 'weapon:GLOCK')!, file = workspace.files.find(f => f.key === entry.file)!;
    const original = await readFile(resolve(root, file.key), 'utf8');
    const racing = new BalanceFileStore(root, async () => {
      await writeFile(resolve(root, file.key), original + '\n'); return content;
    });
    const draft = structuredClone(file.document); set(draft, [...entry.path, 'damage'], 11);
    await expect(racing.save(file.key, file.revision, draft)).rejects.toBeInstanceOf(BalanceConflict);
    expect(await readFile(resolve(root, file.key), 'utf8')).toBe(original + '\n');
  });
  it('checks authored drone, turret and construction rules with their game validators', async () => {
    const { store } = await fixture(), workspace = await store.load();
    for (const key of RULE_FILES) {
      const file = workspace.files.find(f => f.key === key)!, entry = workspace.entries.find(e => e.file === key)!;
      const draft = structuredClone(file.document); set(draft, entry.fields[0].path, -1);
      await expect(store.save(key, file.revision, draft)).rejects.toThrow(/Invalid/);
    }
    const drone = workspace.files.find(f => f.key.endsWith('/attackDrone.json'))!;
    const draft = structuredClone(drone.document); draft.shotIntervalMs = Number(draft.burstMs) + 1;
    await expect(store.save(drone.key, drone.revision, draft)).rejects.toThrow(/Inconsistent/);
  });
});
