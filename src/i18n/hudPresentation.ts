import type { SyncedActiveHudBuff } from '../types';
import { formatNumber, formatPercent } from './format';
import { translate } from './index';
import type { Locale } from './types';

/** Converts semantic, network-safe buff state into a client-local HUD label. */
export function getHudBuffValueText(buff: SyncedActiveHudBuff, locale: Locale): string | undefined {
  const params = (values: Record<string, string | number>) => translate(locale, `ui.buff.${buff.defId}`, values);
  switch (buff.defId) {
    case 'AK47_FOCUS':
      return params({
        stacks: buff.stacks ?? 0,
        max: buff.maxStacks ?? 0,
        bonus: formatPercent(buff.value ?? 0, locale, 0),
      });
    case 'AK47_FIRE_SUPERIORITY':
      return (buff.pendingCount ?? 0) > 0
        ? translate(locale, 'ui.buff.AK47_FIRE_SUPERIORITY.pending', {
          available: buff.availableCount ?? 0,
          pending: buff.pendingCount ?? 0,
        })
        : translate(locale, 'ui.buff.AK47_FIRE_SUPERIORITY.available', {
          available: buff.availableCount ?? 0,
        });
    case 'NEGEV_KILLSTREAK':
      return params({
        count: buff.count ?? 0,
        bonus: formatPercent(buff.value ?? 0, locale, 0),
      });
    case 'MOVEMENT_CHARGE':
      return buff.charged
        ? params({ bonus: formatPercent(buff.value ?? 0, locale, 0) })
        : translate(locale, 'ui.buff.MOVEMENT_CHARGE.charging');
    case 'GLUTWANDERER':
      return params({ count: buff.count ?? 0 });
    case 'SURROUNDED':
      return params({ bonus: formatPercent(buff.value ?? 0, locale, 0) });
    case 'TEAM_REGENERATION_SURGE':
      return params({
        hp: formatNumber(buff.value ?? 0, locale, { maximumFractionDigits: 1 }),
        adrenaline: formatPercent(buff.secondaryValue ?? 0, locale, 0),
      });
    default:
      return undefined;
  }
}
