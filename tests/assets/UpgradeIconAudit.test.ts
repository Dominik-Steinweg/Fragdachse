import { describe, expect, it } from 'vitest';

import { auditUpgradeIcons } from '../../scripts/audit-upgrade-icons.mjs';

describe('active upgrade icon audit', () => {
  it('keeps every active upgrade explicit and every dedicated PNG unique and loadable', async () => {
    const result = await auditUpgradeIcons();

    expect(result.errors).toEqual([]);
    expect(result.activeUpgradeIds).toHaveLength(
      result.dedicated.length + result.noDedicatedIcon.length,
    );
  });
});
