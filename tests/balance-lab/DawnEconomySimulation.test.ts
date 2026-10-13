import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DAWN_ECONOMY } from '../../src/config/dawn/economy';
import { DAWN_MERCHANT } from '../../src/config/dawn/merchant';
import {
  DEFAULT_DAWN_ECONOMY_SAMPLING, sampleDawnEconomyRoundYields, simulateDawnEconomy,
  type DawnEconomyRoundYield,
} from '../../src/dawn/economy/DawnEconomySimulation';

describe('Dawn personal economy calibration', () => {
  it('reaches the authored progression targets at mean income', () => {
    const yields = sampleDawnEconomyRoundYields();
    const result = simulateDawnEconomy({ yields });
    console.table(result.milestones.map(row => ({
      threat: row.threat, rounds: row.roundsToReach, hours: row.hoursToReach.toFixed(2),
      sites: row.siteScrapPerRound.toFixed(2), drops: row.dropScrapPerRound.toFixed(2),
      scrapPerRound: row.creditedScrapPerRound.toFixed(2), expansionCost: row.expansionCost,
    })));
    console.log('Necromancy round:', result.necromancyRound);
    expect(result.milestones[1].roundsToReach).toBeGreaterThanOrEqual(1);
    expect(result.milestones[1].roundsToReach).toBeLessThanOrEqual(3);
    expect(result.milestones[4].hoursToReach).toBeGreaterThanOrEqual(4);
    expect(result.milestones[4].hoursToReach).toBeLessThanOrEqual(5);
    expect(result.milestones[9].hoursToReach).toBeGreaterThanOrEqual(25);
    expect(result.milestones[9].hoursToReach).toBeLessThanOrEqual(30);
    expect(result.necromancyRound).not.toBeNull();
    expect(result.necromancyRound).toBeGreaterThanOrEqual(3);
    expect(result.necromancyRound).toBeLessThanOrEqual(4);
    const alternate = simulateDawnEconomy({ yields: sampleDawnEconomyRoundYields({
      ...DEFAULT_DAWN_ECONOMY_SAMPLING, seedStart: DEFAULT_DAWN_ECONOMY_SAMPLING.seedCount,
    }) });
    // Detect a seed-sensitive calibration rather than blessing one fortunate sample.
    const maxRelativeDifference = Math.max(...result.milestones.map((row, index) =>
      Math.abs(alternate.milestones[index].creditedScrapPerRound / row.creditedScrapPerRound - 1)));
    expect(maxRelativeDifference).toBeLessThan(0.03);
    expect(alternate.milestones[4].hoursToReach).toBeGreaterThanOrEqual(4);
    expect(alternate.milestones[4].hoursToReach).toBeLessThanOrEqual(5);
    expect(alternate.milestones[9].hoursToReach).toBeGreaterThanOrEqual(25);
    expect(alternate.milestones[9].hoursToReach).toBeLessThanOrEqual(30);
    writeReport(result, yields, alternate, maxRelativeDifference);
  }, 30_000);

  it('is deterministic, conserves both budgets and responds monotonically to success rates', () => {
    const sampling = { seedStart: 41, seedCount: 32 };
    const yields = sampleDawnEconomyRoundYields(sampling);
    expect(sampleDawnEconomyRoundYields(sampling)).toEqual(yields);
    const baseline = simulateDawnEconomy({ yields });
    expect(simulateDawnEconomy({ yields })).toEqual(baseline);
    expect(baseline.expansionSpent + baseline.otherSpent + baseline.expansionBalance + baseline.otherBalance)
      .toBeCloseTo(baseline.creditedScrap, 6);
    expect(baseline.otherSpent).toBeCloseTo(baseline.creditedScrap * baseline.parameters.otherPurchaseShare, 6);
    const low = simulateDawnEconomy({ yields, parameters: { victoryRate: 0.7, siteSuccessRate: 0.6 } });
    const high = simulateDawnEconomy({ yields, parameters: { victoryRate: 0.95, siteSuccessRate: 1 } });
    baseline.milestones.forEach((row, index) => {
      expect(low.milestones[index].roundsToReach).toBeGreaterThanOrEqual(row.roundsToReach);
      expect(high.milestones[index].roundsToReach).toBeLessThanOrEqual(row.roundsToReach);
    });
  });

  it('uses authored prices, keeps expansion change and saves for research before other spending', () => {
    // A controlled 100-scrap round isolates the spending policy from scenario composition.
    const yields: DawnEconomyRoundYield[] = Array.from({ length: 10 }, (_, index) => ({
      threat: index + 1, siteCount: 1, siteScrapPotential: 100, dayEnemies: 0,
      nightEnemies: 0, siteAssaultEnemies: 0, dropScrapPotential: 0,
    }));
    const rules = { ...DAWN_ECONOMY, expansionCosts: Array(9).fill(90) };
    const catalog = { ...DAWN_MERCHANT, upgrades: {
      ...DAWN_MERCHANT.upgrades, branches: [{ branchId: 'necromancy', price: 150 }],
    } };
    const result = simulateDawnEconomy({ yields, rules, catalog, parameters: { victoryRate: 1, siteSuccessRate: 1 } });
    expect(result.milestones.map(row => row.roundsToReach)).toEqual([0, 2, 3, 5, 6, 8, 9, 11, 12, 14]);
    expect(result.necromancyRound).toBe(4);
    expect(result.expansionBalance).toBe(30);
    const unaffordable = simulateDawnEconomy({ yields, rules, catalog: { ...catalog, upgrades: {
      ...catalog.upgrades, branches: [{ branchId: 'necromancy', price: 10_000 }],
    } }, parameters: { victoryRate: 1, siteSuccessRate: 1 } });
    expect(unaffordable.necromancyRound).toBeNull();
    expect(unaffordable.otherSpent).toBe(0);
    expect(unaffordable.otherBalance).toBe(560);
    const defeated = simulateDawnEconomy({ yields, rules, parameters: { victoryRate: 0, siteSuccessRate: 1 } });
    expect(defeated.milestones[0].creditedScrapPerRound).toBe(100 * rules.defeatScrapShare);
    expect(() => simulateDawnEconomy({ yields, parameters: { otherPurchaseShare: 1 } })).toThrow('No expansion budget');
  });
});

/** Diagnostic artifact owned by this opt-in balance-lab suite; production stays I/O-free. */
function writeReport(
  result: ReturnType<typeof simulateDawnEconomy>, yields: readonly DawnEconomyRoundYield[],
  alternate: ReturnType<typeof simulateDawnEconomy>, maxRelativeDifference: number,
): void {
  const number = (value: number) => value.toFixed(2);
  const baselineTable = result.milestones.map((row, index) =>
    `| ${row.threat} | ${row.roundsToReach} | ${number(row.hoursToReach)} | ${index === 0 ? 0
      : row.roundsToReach - result.milestones[index - 1].roundsToReach} | ${number(row.siteScrapPerRound)} | ${number(row.dropScrapPerRound)} | ${number(row.creditedScrapPerRound)} | ${row.expansionCost ?? '–'} |`);
  const sourceTable = yields.map(row =>
    `| ${row.threat} | ${row.siteCount} | ${number(row.siteScrapPotential)} | ${number(row.dayEnemies)} | ${number(row.siteAssaultEnemies)} | ${number(row.nightEnemies)} |`);
  const sensitivity: string[] = [];
  for (const victoryRate of [0.7, 0.85, 0.95]) {
    for (const siteSuccessRate of [0.6, 0.8, 1]) {
      const scenario = simulateDawnEconomy({ yields, parameters: { victoryRate, siteSuccessRate } });
      sensitivity.push(`| ${victoryRate * 100} % | ${siteSuccessRate * 100} % | ${scenario.milestones[1].roundsToReach} | ${number(scenario.milestones[4].hoursToReach)} | ${number(scenario.milestones[9].hoursToReach)} | ${scenario.necromancyRound} |`);
    }
  }
  const budgetRounds = (price: number, threat: number) => number(price
    / (result.milestones[threat - 1].creditedScrapPerRound * result.parameters.otherPurchaseShare));
  const merchantRows = [
    `| Nekromantie | ${result.necromancyCost} | T1: ${budgetRounds(result.necromancyCost, 1)} | Tatsächlich Runde ${result.necromancyRound}, da ab Runde 3 auf T2 gespielt wird. |`,
    `| Boss-Punkte, erster / letzter | ${DAWN_MERCHANT.upgrades.bossPointPrices[0]} / ${DAWN_MERCHANT.upgrades.bossPointPrices.at(-1)} | T1 erster: ${budgetRounds(DAWN_MERCHANT.upgrades.bossPointPrices[0], 1)}; T10 letzter: ${budgetRounds(DAWN_MERCHANT.upgrades.bossPointPrices.at(-1)!, 10)} | Früher kleiner Kauf; spätere Punkte bleiben wiederholte Ausgaben. |`,
    ...DAWN_MERCHANT.infrastructure.map(entry => `| ${entry.id} | ${entry.levelPrices.join(' / ')} | ${entry.levelPrices.map((price, index) => {
      const threat = [1, 5, 8][index];
      return `Stufe ${index + 1} auf T${threat}: ${budgetRounds(price, threat)}`;
    }).join('; ')} | Größere Sparziele; spätere Stufen am höheren Einkommen bemessen. |`),
    ...Object.entries(DAWN_MERCHANT.equipment.itemPriceByRarity).map(([rarity, price]) =>
      `| Item ${rarity}, Grundpreis | ${price} | T1: ${budgetRounds(price, 1)} | Wiederkehrende Alternative zu permanenten Käufen. |`),
    `| Rekalibrierungskern | ${DAWN_MERCHANT.equipment.recalibrationCorePrice} | T1: ${budgetRounds(DAWN_MERCHANT.equipment.recalibrationCorePrice, 1)} | Mehrere Runden Händlerbudget pro frühem Kern. |`,
  ];
  const lines = [
    '# M2 – Dawn-Economy-Simulation und Kostenkalibrierung', '',
    'Automatisch aus authored Daten erzeugt; keine manuell abgeschriebene Ertragstabelle.', '',
    '## Reproduktion und Quellen', '',
    '`npx vitest run tests/balance-lab/DawnEconomySimulation.test.ts --pool=threads --no-cache --configLoader runner`', '',
    'Auch `npm run test:balance-lab -- --no-cache --configLoader runner` schreibt diesen Bericht nach bestandener Kalibrierungsprüfung.', '',
    `Szenario-Content-Hash: \`${result.contentHash}\`. Seeds ${DEFAULT_DAWN_ECONOMY_SAMPLING.seedStart}–${DEFAULT_DAWN_ECONOMY_SAMPLING.seedCount - 1}, je Threat ${DEFAULT_DAWN_ECONOMY_SAMPLING.seedCount} Pläne.`, '',
    '- `src/dawn/economy/DawnEconomySimulation.ts`: reine Simulation, benannte Parameter.',
    '- `composeDawnRoundPlans` und `dawnContent.ts`: Arena, Sites, Tiers, Archetypen, Budgets, Fronten, Wellenblöcke und Zeitplan.',
    '- `siteArchetypes.json`: Tier-Rewards und Extraktor-Angriffsbudgets; `salvage.json`: räumliche Slot-Regeln, kein zusätzlicher Geldbonus.',
    '- `threatCurves.json`: Site-Anzahl, Tier-Gewichte, Schrottmultiplikator und Dropchancen/-Definition; `DAWN_SCRAP_DEFS`: Dropmenge.',
    '- `economy.json` / `merchant.json`: persönliche Preise und Niederlagenanteil; außerhalb des Szenario-Content-Hashes.', '',
    '## Annahmen und Modellgrenzen', '',
    ...Object.entries(result.parameters).map(([key, value]) => `- \`${key}\` = ${value}.`),
    `- Niederlagenanteil aus authored Daten: ${DAWN_ECONOMY.defeatScrapShare}; erwarteter Auszahlungsfaktor: ${(result.parameters.victoryRate + (1 - result.parameters.victoryRate) * DAWN_ECONOMY.defeatScrapShare).toFixed(3)}.`,
    '- Start bei Threat 1 ohne Schrott. Eigene Host-Progression; keine Beschleunigung durch Gäste auf höherem Host-Threat. Alle Teilnehmer erhalten den vollen gemeinsamen Schrott, keine Division durch die Spielerzahl.',
    '- Sechs Runden pro Stunde: acht Minuten Spiel plus Lobby, auch bei Niederlagen. Alle Sites werden versucht; der Site-Erfolg reduziert nur Abschlussbelohnungen. Extraktor-Angriffe entstehen auch bei fehlgeschlagenen Versuchen.',
    '- Alle geplanten Gegner gelten als besiegt, alle Drops als gesammelt. Tages-/Nachtzuordnung über den Wellenstart; Site-Angriffe tagsüber. Keine Combat-Simulation, zeitlich vorgezogenen Niederlagen, sekundären Beschwörungen oder über die Phasengrenze lebenden Gegner.',
    '- Site-Schrott = Mittelwert der Summe von floor(Tier-Reward × Threat-Multiplikator), danach × Site-Erfolg. Keine erfundene zusätzliche Entfernungsprämie: höhere Tiers werden vom Komponisten weiter außen platziert.',
    '- Drop-Schrott = mittlere Gegnerzahl je Phase × deren Dropchance × Menge der gewählten Pickup-Definition. Die Definition legt derzeit eine feste Menge je Threat fest; kein pauschaler Mittelwert aus 1–3.',
    '- Gutschrift = (Site-Schrott + Drop-Schrott) × [Siegquote + (1 − Siegquote) × Niederlagenanteil]. Bruchteile bleiben als Erwartungswerte erhalten. Die echte Auszahlungsabrundung bei Niederlage entfällt: Überschätzung kleiner als (1 − Siegquote) Schrott pro Runde, im Basismodell < 0,15.',
    '- 60 % der Gutschrift sind für Expansion reserviert, 40 % für andere Käufe. Expansion sofort nach einer Runde, sobald ihr Budget reicht; Rest wird mitgenommen. Es wird nicht aus dem Händlerbudget geliehen.',
    '- Das Händlerbudget spart zuerst vollständig auf Nekromantie. Danach wird es als aggregierter Warenkorb ausgegeben (inklusive Sparen auf größere Käufe); keine behauptete konkrete Kaufreihenfolge oder Angebotsverfügbarkeit. Die übrigen Händlerpreise werden relativ zu diesem Budget kalibriert, beeinflussen die feste 40-%-Quote aber nicht.',
    '- Runden bei mittlerem Einkommen, keine statistische Verteilung zufälliger Kaufzeitpunkte. Siegquote, Site-Erfolg und Drops werden analytisch gewichtet; nur die Rundenzusammenstellung wird über Seeds gemittelt.', '',
    '## Ergebnis', '',
    `Threat 2: ${result.milestones[1].roundsToReach} Runden; Threat 5: ${number(result.milestones[4].hoursToReach)} h; Threat 10: ${number(result.milestones[9].hoursToReach)} h; Nekromantie: Runde ${result.necromancyRound}.`, '',
    'Runden/Stunden bezeichnen das erstmalige Erreichen der Zeile. Ertrag und Kosten gelten dagegen für das Spielen auf diesem Threat und die Expansion zum nächsten Threat. Site-/Drop-Spalten sind vor, Gutschrift nach dem Sieg-/Niederlagenfaktor.', '',
    '| Threat | Runden kumuliert | Stunden kumuliert | Runden seit vorigem Threat | Site-Schrott/Runde | Drop-Schrott/Runde | Gutschrift/Runde | Kosten zum nächsten Threat |',
    '|---|---|---|---|---|---|---|---|', ...baselineTable, '',
    `Bis T10: ${number(result.creditedScrap)} Schrott gutgeschrieben, ${result.expansionSpent} für Expansion, ${number(result.otherSpent)} für andere Käufe inklusive Nekromantie; ${number(result.expansionBalance + result.otherBalance)} Rest.`, '',
    '## Zusammensetzung aus den Plänen', '',
    '| Threat | Sites | Site-Schrott bei 100 % Erfolg | Tagesgegner | Site-Angriffsgegner | Nachtgegner |',
    '|---|---|---|---|---|---|', ...sourceTable, '',
    '## Händlerkalibrierung', '',
    'Budgetrunden = Preis / 40 % der Gutschrift auf dem angegebenen Threat, ohne konkurrierende Käufe; keine zusätzlichen Progressionsziele. Infrastruktur und Boss-Punkte kosten 60 % der v0-Preise, frühe Ausrüstung etwa zwei Drittel. Nekromantie sinkt von 250 auf 100, damit das erste Forschungsziel nicht mehr bis Runde 8 dauert.', '',
    '| Kauf | Preis | Händlerbudget in Runden | Entscheidung |',
    '|---|---|---|---|', ...merchantRows, '',
    `Item-Preiswachstum je Threat: ${(DAWN_MERCHANT.equipment.itemPriceGrowthPerThreat * 100).toFixed(0)} % statt 25 %. Das erhält wiederkehrende Ausrüstung als bezahlbare Alternative bei späterem Threat. Angebotszahl, Kaufgrenzen, IDs und Schema bleiben unverändert.`, '',
    'Die Expansionskosten wurden auf etwa 2 / 6 / 8 / 11 / 18 / 22 / 27 / 32 / 39 zusätzliche Runden ausgerichtet, aus dem gemessenen Netto-Ertrag berechnet und auf handhabbare Preise gerundet. Weder Site-Belohnungen noch Threat-Kurven wurden geändert; der Szenario-Content-Hash bleibt unverändert.', '',
    '## Sensitivität', '',
    'Vollständige 3×3-Kombination bei denselben Plänen, Preisen, sechs Runden/h und derselben Ausgabepolitik. Die Zielbänder gelten für 85 % Siegquote und 80 % Site-Erfolg.', '',
    '| Siege | Site-Erfolg | T2 Runden | T5 Stunden | T10 Stunden | Nekromantie Runde |',
    '|---|---|---|---|---|---|', ...sensitivity, '',
    '## Seed-Stabilität', '',
    `Zweiter disjunkter Bereich: Seeds ${DEFAULT_DAWN_ECONOMY_SAMPLING.seedCount}–${2 * DEFAULT_DAWN_ECONOMY_SAMPLING.seedCount - 1}. Größte relative Abweichung der Gutschrift je Threat: ${number(maxRelativeDifference * 100)} %. T2: ${alternate.milestones[1].roundsToReach} Runden; T5: ${number(alternate.milestones[4].hoursToReach)} h; T10: ${number(alternate.milestones[9].hoursToReach)} h; Nekromantie: Runde ${alternate.necromancyRound}. Kein statistisches Konfidenzintervall.`, '',
  ];
  const directory = resolve('build/dawn');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'M2-economy.md'), lines.join('\n'), 'utf8');
}
