// Copied by scripts/check/fingerprints.mjs into a source snapshot as tests/campaign-fingerprints.test.ts.
// Writes ArenaGenerator fingerprints of every campaign map for two seeds to FP_OUT.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { getArenaMetricsProfile } from '../src/config';
import { getCoopDefenseCampaignAudit, getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';

it('campaign fingerprints', () => {
  const out: Record<string, string> = {};
  for (const entry of getCoopDefenseCampaignAudit()) {
    const map = getCoopDefenseMapConfig(entry.mapId);
    const metrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA', map.arenaWidthCells, map.arenaHeightCells));
    for (const seed of [1, 12345]) {
      out[`${entry.mapId}:${seed}`] = String(ArenaGenerator.fingerprint(ArenaGenerator.generate(seed, resolveArenaGenerationInput('coop_defense', metrics), map)));
    }
  }
  writeFileSync(process.env.FP_OUT!, JSON.stringify(out, null, 1));
});
