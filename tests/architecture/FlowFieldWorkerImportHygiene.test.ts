import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Dateien des Worker-Graphen. Sie werden von Vite in einen eigenen Chunk gebundelt, auf den
 * `build.rollupOptions.output.manualChunks` nicht wirkt: Ein einziger Import auf `phaser` oder die
 * Netzwerkschicht wuerde dort komplett mit hineinwandern.
 *
 * `src/config.ts` ist zusaetzlich verboten, weil `GRID_COLS`, `GRID_ROWS` und `ARENA_OFFSET_*`
 * mutable `let`-Exporte sind. Der Worker saehe eine zweite Modulinstanz mit Default-Werten und
 * damit ein anderes Raster als der Main Thread. Alle Kosten und Masse kommen deshalb als Nachricht.
 */
const WORKER_GRAPH_FILES = [
  'src/systems/flowfield/FlowFieldKernel.ts',
  'src/systems/flowfield/FlowFieldProtocol.ts',
  'src/systems/flowfield/FlowFieldEngine.ts',
  'src/systems/flowfield/FlowFieldWorker.ts',
];

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{ readonly label: string; readonly test: RegExp }> = [
  { label: 'phaser', test: /^phaser(\/|$)/ },
  { label: 'src/config.ts', test: /(^|\/)\.\.\/(\.\.\/)*config$/ },
  { label: 'src/types.ts', test: /(^|\/)\.\.\/(\.\.\/)*types$/ },
  { label: 'src/arena/BaseRegistry.ts', test: /BaseRegistry$/ },
  { label: 'src/network/**', test: /network\// },
  { label: 'src/scenes/**', test: /scenes\// },
];

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  let match = pattern.exec(source);
  while (match !== null) {
    specifiers.push(match[1] ?? match[2]);
    match = pattern.exec(source);
  }
  return specifiers;
}

describe('Flow field worker import hygiene', () => {
  for (const file of WORKER_GRAPH_FILES) {
    it(`keeps ${file} free of main-thread-only modules`, () => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      const specifiers = collectImportSpecifiers(source);
      expect(specifiers.length).toBeGreaterThanOrEqual(0);

      for (const specifier of specifiers) {
        for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
          expect(
            forbidden.test.test(specifier),
            `${file} must not import ${forbidden.label} (found "${specifier}")`,
          ).toBe(false);
        }
        // Positiv formuliert: nur relative Geschwister im selben Verzeichnis.
        expect(
          specifier.startsWith('./'),
          `${file} may only import relative siblings (found "${specifier}")`,
        ).toBe(true);
      }
    });
  }
});