import {
  DAWN_CONTENT_HASH, getDawnSchedule, getDawnSiteArchetype, getDawnSiteArchetypeTier,
  getDawnThreatCurve, getDawnWaveBlock,
} from '../../config/dawn/dawnContent';
import { DAWN_ECONOMY, type DawnEconomyRules } from '../../config/dawn/economy';
import { DAWN_MERCHANT, type DawnMerchantCatalog } from '../../config/dawn/merchant';
import { DAWN_SCRAP_DEFS } from '../../powerups/PowerUpConfig';
import { composeDawnRoundPlans } from '../composition/DawnRoundComposition';
import { DAWN_MAX_THREAT } from '../contracts/DawnPlans';
import { resolveDawnPhase } from '../rules/DawnPhase';
import { resolveDawnExpansionCost } from './DawnEconomy';

/** Analysis assumptions, not gameplay rules or a persistence document. */
export interface DawnEconomySimulationParameters {
  /** Six minutes of play plus lobby time: eight completed rounds per hour. */
  readonly roundsPerHour: number;
  /** Probability of a victory; defeat keeps the authored defeatScrapShare. */
  readonly victoryRate: number;
  /** All sites are attempted; this fraction pays its completion reward. */
  readonly siteSuccessRate: number;
  /** Reserved from credited income before purchases; the rest funds expansion. */
  readonly otherPurchaseShare: number;
  /** Fraction of planned enemies killed, including assaults at attempted sites. */
  readonly enemyKillShare: number;
  /** Fraction of dropped scrap collected. */
  readonly dropCollectionShare: number;
}

export const DEFAULT_DAWN_ECONOMY_PARAMETERS: DawnEconomySimulationParameters = Object.freeze({
  roundsPerHour: 8,
  victoryRate: 0.85,
  siteSuccessRate: 0.8,
  otherPurchaseShare: 0.4,
  enemyKillShare: 1,
  dropCollectionShare: 1,
});

export const DEFAULT_DAWN_ECONOMY_SAMPLING = Object.freeze({ seedStart: 0, seedCount: 1024 });

export interface DawnEconomyRoundYield {
  readonly threat: number;
  readonly siteCount: number;
  /** Sum of individually floored site rewards, before the success probability. */
  readonly siteScrapPotential: number;
  readonly dayEnemies: number;
  readonly nightEnemies: number;
  readonly siteAssaultEnemies: number;
  /** Chance and amount from scrapDrops / DAWN_SCRAP_DEFS, before kill/collection shares. */
  readonly dropScrapPotential: number;
}

/**
 * Sample the production composer, preserving its guaranteed archetypes, tier/slot selection,
 * affordable block selection, budget carry and site assaults. No second budget allocator.
 * Conditional rewards/drops are integrated analytically, not rolled with another RNG.
 * Enemies are assumed killed in their wave's phase; site assaults count as daytime kills.
 * This deliberately does not simulate combat timing, early defeat or secondary summons.
 */
export function sampleDawnEconomyRoundYields(
  sampling: { readonly seedStart: number; readonly seedCount: number } = DEFAULT_DAWN_ECONOMY_SAMPLING,
): DawnEconomyRoundYield[] {
  const { seedStart, seedCount } = sampling;
  if (!Number.isSafeInteger(seedCount) || seedCount < 1 || !Number.isSafeInteger(seedStart)
    || seedStart < 0 || seedStart + seedCount > 2 ** 32) {
    throw new Error('[DawnEconomySimulation] Invalid seed range');
  }
  return Array.from({ length: DAWN_MAX_THREAT }, (_, index) => {
    const threat = index + 1;
    const curve = getDawnThreatCurve(threat);
    const schedule = getDawnSchedule(curve.scheduleId);
    const amount = DAWN_SCRAP_DEFS[curve.scrapDrops.pickupDefId].amount!;
    let siteCount = 0;
    let siteScrapPotential = 0;
    let dayEnemies = 0;
    let nightEnemies = 0;
    let siteAssaultEnemies = 0;
    for (let seed = seedStart; seed < seedStart + seedCount; seed += 1) {
      const plans = composeDawnRoundPlans({ seed, threat, dayNumber: 1 });
      siteCount += plans.world.sites.length;
      for (const site of plans.world.sites) {
        const tier = getDawnSiteArchetypeTier(getDawnSiteArchetype(site.archetypeId), site.tier);
        siteScrapPotential += Math.floor(tier.scrapReward * curve.scrapMultiplier);
      }
      for (const wave of plans.activity.waves) {
        const enemies = getDawnWaveBlock(wave.blockId).groups.reduce((sum, group) => sum + group.count, 0);
        if ('siteId' in wave) siteAssaultEnemies += enemies;
        else if (resolveDawnPhase(schedule, wave.atMs).phase === 'night') nightEnemies += enemies;
        else dayEnemies += enemies;
      }
    }
    return {
      threat, siteCount: siteCount / seedCount, siteScrapPotential: siteScrapPotential / seedCount,
      dayEnemies: dayEnemies / seedCount, nightEnemies: nightEnemies / seedCount,
      siteAssaultEnemies: siteAssaultEnemies / seedCount,
      dropScrapPotential: amount * ((dayEnemies + siteAssaultEnemies) * curve.scrapDrops.dayChance
        + nightEnemies * curve.scrapDrops.nightChance) / seedCount,
    };
  });
}

export interface DawnEconomyMilestone extends DawnEconomyRoundYield {
  /** Completed rounds on lower threats; the new threat is playable next round. */
  readonly roundsToReach: number;
  readonly hoursToReach: number;
  readonly siteScrapPerRound: number;
  readonly dropScrapPerRound: number;
  readonly grossScrapPerRound: number;
  readonly creditedScrapPerRound: number;
  /** Price to leave this threat; null at the maximum. */
  readonly expansionCost: number | null;
}

/**
 * Expected-income trajectory from zero scrap / expansion level zero, on one's own threat.
 * Two accounting envelopes implement the 60/40 policy: buy expansion immediately when its
 * envelope can afford it, keep change, never borrow from the merchant envelope. Its first
 * purchase is authored necromancy; afterwards that envelope is an aggregate basket of other
 * purchases (not a fabricated item-offer or infrastructure-order simulation).
 *
 * Fractional expected income is retained. Actual integer payout flooring is omitted here:
 * error < (1 - victoryRate) scrap per round, since gross runtime scrap is already integer.
 * Thus these are rounds at mean income, not a Monte Carlo mean of random first-passage times.
 * No storage, renderer, clock, I/O or global mutable cache is involved.
 */
export function simulateDawnEconomy(options: {
  readonly parameters?: Partial<DawnEconomySimulationParameters>;
  readonly yields?: readonly DawnEconomyRoundYield[];
  readonly rules?: DawnEconomyRules;
  readonly catalog?: DawnMerchantCatalog;
} = {}) {
  const parameters = { ...DEFAULT_DAWN_ECONOMY_PARAMETERS, ...options.parameters };
  const rules = options.rules ?? DAWN_ECONOMY;
  const catalog = options.catalog ?? DAWN_MERCHANT;
  for (const [key, value] of Object.entries(parameters)) {
    if (!Number.isFinite(value) || (key === 'roundsPerHour' ? value <= 0 : value < 0 || value > 1)) {
      throw new Error(`[DawnEconomySimulation] Invalid parameter ${key}`);
    }
  }
  if (parameters.otherPurchaseShare === 1) throw new Error('[DawnEconomySimulation] No expansion budget');
  const yields = options.yields ?? sampleDawnEconomyRoundYields();
  if (yields.length !== DAWN_MAX_THREAT || yields.some((row, index) => row.threat !== index + 1
    || Object.values(row).some(value => !Number.isFinite(value) || value < 0))) {
    throw new Error('[DawnEconomySimulation] Expected ordered yields for every threat');
  }
  const necromancyCost = catalog.upgrades.branches.find(branch => branch.branchId === 'necromancy')?.price;
  if (necromancyCost === undefined) throw new Error('[DawnEconomySimulation] Missing necromancy price');
  const payoutShare = parameters.victoryRate + (1 - parameters.victoryRate) * rules.defeatScrapShare;
  const milestones: DawnEconomyMilestone[] = yields.map(row => {
    const siteScrapPerRound = row.siteScrapPotential * parameters.siteSuccessRate;
    const dropScrapPerRound = row.dropScrapPotential * parameters.enemyKillShare * parameters.dropCollectionShare;
    const grossScrapPerRound = siteScrapPerRound + dropScrapPerRound;
    return {
      ...row, roundsToReach: 0, hoursToReach: 0, siteScrapPerRound, dropScrapPerRound,
      grossScrapPerRound, creditedScrapPerRound: grossScrapPerRound * payoutShare,
      expansionCost: resolveDawnExpansionCost(row.threat - 1, rules),
    };
  });
  let rounds = 0;
  let level = 0;
  let expansionBalance = 0;
  let otherBalance = 0;
  let creditedScrap = 0;
  let expansionSpent = 0;
  let otherSpent = 0;
  let necromancyRound: number | null = null;
  while (level < milestones.length - 1) {
    const row = milestones[level];
    const expansionIncome = row.creditedScrapPerRound * (1 - parameters.otherPurchaseShare);
    if (expansionIncome <= 0 || row.expansionCost === null) {
      throw new Error('[DawnEconomySimulation] Maximum threat is unreachable');
    }
    // Jump to the next purchase, still buying only after whole completed rounds.
    const duration = Math.max(0, Math.ceil((row.expansionCost - expansionBalance) / expansionIncome));
    const otherIncome = row.creditedScrapPerRound * parameters.otherPurchaseShare;
    if (necromancyRound === null && otherIncome > 0 && otherBalance + duration * otherIncome >= necromancyCost) {
      necromancyRound = rounds + Math.ceil((necromancyCost - otherBalance) / otherIncome);
    }
    rounds += duration;
    creditedScrap += duration * row.creditedScrapPerRound;
    expansionBalance += duration * expansionIncome - row.expansionCost;
    expansionSpent += row.expansionCost;
    otherBalance += duration * otherIncome;
    if (necromancyRound !== null) {
      // Includes the one-off research price; remaining money funds the aggregate basket.
      otherSpent += otherBalance;
      otherBalance = 0;
    }
    level += 1;
    milestones[level] = { ...milestones[level], roundsToReach: rounds, hoursToReach: rounds / parameters.roundsPerHour };
  }
  return {
    contentHash: DAWN_CONTENT_HASH, parameters, milestones, necromancyCost, necromancyRound,
    creditedScrap, expansionSpent, otherSpent, expansionBalance, otherBalance,
  };
}
