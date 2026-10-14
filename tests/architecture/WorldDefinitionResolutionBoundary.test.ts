import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Definitions-Lookups laufen ueber `src/world/WorldDefinitionResolution.ts`.
 *
 * Ein direkter Lookup per Definitions-ID kennt generierte Szenarien (Dawn) nicht und faellt bei
 * `getCoopDefenseMapConfig` sogar still auf die Default-Karte zurueck. Die Allowlists duerfen nur
 * schrumpfen: Jeder verbliebene Eintrag nennt, warum er die aktive World nicht braucht.
 */
const LOOKUP_BOUNDARIES = [
  {
    lookup: /\btoMapId\(/,
    allowed: new Map([
      ['src/world/arenaDescriptorAdapter.ts', 'definiert die Kampagnen-ID-Zuordnung'],
      ['src/world/WorldDefinitionResolution.ts', 'Owner'],
      ['src/scenes/ArenaScene.ts', 'Kartenname im Countdown; Dawn zeigt den Moduslabel'],
      ['src/debug/coopDefenseBalance/WeaponBalanceLabRuntime.ts', 'interne Diagnosekarte'],
    ]),
  },
  {
    lookup: /\bgetCoopDefenseMapConfig\(/,
    allowed: new Map([
      ['src/config/coopDefenseMaps.ts', 'Kampagnenregistry'],
      ['src/world/WorldDefinitionResolution.ts', 'Owner'],
      ['src/network/NetworkBridge.ts', 'normalisiert die Lobby-Kartenauswahl'],
      ['src/scenes/arena/ArenaLifecycleCoordinator.ts', 'Lobby-Kartenauswahl vor der World-Erzeugung'],
      ['src/scenes/ArenaScene.ts', 'Lobby-Kartenauswahl ohne Runden-World'],
      ['src/scenes/arena/ArenaMetaController.ts', 'Kampagnenfortschritt einer abgeschlossenen Kampagnenkarte'],
      ['src/scenes/arena/ArenaRuntimeAdapters.ts', 'Diagnose-Spawnfaelle der Lobby-Karte'],
      ['src/debug/performanceLab/referenceMap.ts', 'Perf-Lab-Referenzkarten'],
    ]),
  },
  {
    lookup: /\bget(?:World|Activity)Definition\(/,
    allowed: new Map([
      ['src/config/authoring/authoredScenarios.ts', 'authored Registry'],
      ['src/world/WorldDefinitionResolution.ts', 'Owner'],
    ]),
  },
] as const;

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

const SOURCES = listSourceFiles(resolve(process.cwd(), 'src')).map((path) => ({
  path: relative(process.cwd(), path).replaceAll('\\', '/'),
  // Kommentare duerfen die Lookups nennen; geprueft wird nur Code.
  text: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
}));

describe('World definition resolution boundary', () => {
  it.each(LOOKUP_BOUNDARIES.map((boundary) => [String(boundary.lookup), boundary] as const))(
    'keeps %s lookups behind the resolution owner',
    (_label, boundary) => {
      const users = SOURCES.filter(({ text }) => boundary.lookup.test(text)).map(({ path }) => path).sort();
      const unexpected = users.filter((path) => !boundary.allowed.has(path));
      const stale = [...boundary.allowed.keys()].filter((path) => !users.includes(path));

      expect(unexpected, 'resolve through src/world/WorldDefinitionResolution.ts').toEqual([]);
      expect(stale, 'remove migrated files from the allowlist').toEqual([]);
    },
  );
});
