import { describe, expect, it } from 'vitest';
import { COOP_DEFENSE_AFFIX_RULES } from '../src/config/coopDefenseItems';
import { CoopDefenseItemRuntimeSystem } from '../src/systems/CoopDefenseItemRuntimeSystem';

/**
 * Der lebende Zustand der Laufzeit-Affixe. Bewusst ohne Phaser und ohne `CombatSystem`: das
 * System kennt weder Szene noch Schadenspfad, es beantwortet nur Fragen und meldet Absichten.
 */

/** Baut ein System mit festen Affixwerten, festem HP-Verhaeltnis und gesteuertem Zufall. */
function build(options: {
  affixes?: Record<string, number>;
  hp?: Record<string, { hp: number; maxHp: number }>;
  positions?: Record<string, { x: number; y: number }>;
  classIds?: Record<string, string | null>;
  rolls?: number[];
} = {}): CoopDefenseItemRuntimeSystem {
  const affixes = options.affixes ?? {};
  const hp = options.hp ?? {};
  const positions = options.positions ?? {};
  const classIds = options.classIds ?? {};
  const rolls = options.rolls ?? [0];
  let index = 0;
  return new CoopDefenseItemRuntimeSystem(
    {
      getAffixValue: (_playerId, affixId) => affixes[affixId] ?? 0,
      getPlayerHp: (playerId) => hp[playerId] ?? null,
      getPlayerPosition: (playerId) => positions[playerId] ?? null,
      getPlayerClassId: (playerId) => classIds[playerId] ?? null,
    },
    () => rolls[index++ % rolls.length],
  );
}

describe('Kampfaufladung', () => {
  it('stapelt bis zum Maximum und erneuert die Dauer aller Stapel', () => {
    const system = build({ affixes: { adrenaline_kill_charge: 0.03 } });
    system.initPlayer('p', 0);

    for (let kill = 0; kill < 8; kill++) system.registerOwnKill('p', 1_000);
    expect(system.getKillChargeStacks('p', 1_000)).toBe(COOP_DEFENSE_AFFIX_RULES.killChargeMaxStacks);

    // Ein spaeterer Kill haelt alle Stapel am Leben, statt nur den neuen.
    system.registerOwnKill('p', 3_500);
    const stillAlive = 3_500 + COOP_DEFENSE_AFFIX_RULES.killChargeDurationMs - 1;
    expect(system.getKillChargeStacks('p', stillAlive)).toBe(COOP_DEFENSE_AFFIX_RULES.killChargeMaxStacks);
  });

  it('laeuft vollstaendig ab statt einzeln abzubauen', () => {
    const system = build({ affixes: { adrenaline_kill_charge: 0.03 } });
    system.initPlayer('p', 0);
    system.registerOwnKill('p', 0);
    const expired = COOP_DEFENSE_AFFIX_RULES.killChargeDurationMs;
    expect(system.getKillChargeStacks('p', expired)).toBe(0);
    expect(system.getAdrenalineRegenMultiplier('p', expired)).toBe(1);
  });

  it('bleibt ohne das Affix wirkungslos', () => {
    const system = build();
    system.initPlayer('p', 0);
    system.registerOwnKill('p', 0);
    expect(system.getKillChargeStacks('p', 0)).toBe(0);
    expect(system.getAdrenalineRegenMultiplier('p', 0)).toBe(1);
  });

  it('skaliert die Adrenalinregeneration je Stapel', () => {
    const system = build({ affixes: { adrenaline_kill_charge: 0.03 } });
    system.initPlayer('p', 0);
    system.registerOwnKill('p', 0);
    system.registerOwnKill('p', 0);
    expect(system.getAdrenalineRegenMultiplier('p', 0)).toBeCloseTo(1.06, 10);
  });
});

describe('Schockreaktion und Dornenplatten', () => {
  it('erzeugt Adrenalin proportional zum tatsaechlichen Verlust', () => {
    const system = build({ affixes: { adrenaline_from_damage: 0.08 } });
    system.initPlayer('p', 0);

    const small = system.handlePlayerDamageTaken('p', 'e', 10, 0, 'direct', 1_000);
    const large = system.handlePlayerDamageTaken('p', 'e', 60, 40, 'direct', 1_000);
    expect(small.adrenalineGain).toBeCloseTo(0.8, 10);
    expect(large.adrenalineGain).toBeCloseTo(8, 10);
  });

  it('meldet nichts, wenn tatsaechlich nichts verloren ging', () => {
    const system = build({ affixes: { adrenaline_from_damage: 0.08, damage_reflection: 0.1 } });
    system.initPlayer('p', 0);
    const result = system.handlePlayerDamageTaken('p', 'e', 0, 0, 'direct', 1_000);
    expect(result).toEqual({ adrenalineGain: 0, reflectedDamage: 0 });
  });

  it('wirft einen Anteil aus HP- und Ruestungsverlust auf den Verursacher zurueck', () => {
    const system = build({ affixes: { damage_reflection: 0.1 } });
    system.initPlayer('p', 0);
    const result = system.handlePlayerDamageTaken('p', 'angreifer', 30, 20, 'direct', 1_000);
    expect(result.reflectedDamage).toBeCloseTo(5, 10);
    expect(result.reflectTargetId).toBe('angreifer');
  });

  it('erzeugt keine Dornenkette und reflektiert ohne Verursacher nicht', () => {
    const system = build({ affixes: { damage_reflection: 0.5 } });
    system.initPlayer('p', 0);

    // Reflektierter Schaden darf nicht erneut reflektiert werden.
    expect(system.handlePlayerDamageTaken('p', 'gegner', 40, 0, 'reflect', 1_000).reflectedDamage).toBe(0);
    // Ohne eindeutigen Verursacher ebenfalls nicht.
    expect(system.handlePlayerDamageTaken('p', undefined, 40, 0, 'direct', 1_000).reflectedDamage).toBe(0);
    // Und Selbstschaden wirft nichts auf einen selbst zurueck.
    expect(system.handlePlayerDamageTaken('p', 'p', 40, 0, 'direct', 1_000).reflectedDamage).toBe(0);
  });
});

describe('Notfallreparatur', () => {
  const delay = COOP_DEFENSE_AFFIX_RULES.emergencyRepairDelayMs;

  it('greift erst nach der Wartezeit und endet mit dem naechsten Treffer', () => {
    const system = build({ affixes: { out_of_combat_armor_repair: 6 } });
    system.initPlayer('p', 0);

    system.handlePlayerDamageTaken('p', 'e', 10, 0, 'direct', 10_000);
    expect(system.getBonusArmorRegenPerSecond('p', 10_000 + delay - 1)).toBe(0);
    expect(system.getBonusArmorRegenPerSecond('p', 10_000 + delay)).toBe(6);

    system.handlePlayerDamageTaken('p', 'e', 1, 0, 'direct', 20_000);
    expect(system.getBonusArmorRegenPerSecond('p', 20_000 + 1)).toBe(0);
  });

  it('ist direkt nach dem Spawn aktiv statt erst nach der Wartezeit', () => {
    const system = build({ affixes: { out_of_combat_armor_repair: 5 } });
    system.initPlayer('p', 50_000);
    expect(system.getBonusArmorRegenPerSecond('p', 50_000)).toBe(5);
  });

  it('bleibt ohne das Affix bei null', () => {
    const system = build();
    system.initPlayer('p', 0);
    expect(system.getBonusArmorRegenPerSecond('p', 999_999)).toBe(0);
  });
});

describe('HP-abhaengige Affixe', () => {
  it('gibt Blutrausch unter und Unversehrt ab der Schwelle', () => {
    const affixes = { low_hp_blood_rage: 0.12, high_hp_damage: 0.08 };
    const low = build({ affixes, hp: { p: { hp: 39, maxHp: 100 } } });
    const middle = build({ affixes, hp: { p: { hp: 60, maxHp: 100 } } });
    const high = build({ affixes, hp: { p: { hp: 95, maxHp: 100 } } });

    expect(low.getConditionalOutgoingDamageBonus('p')).toBeCloseTo(0.12, 10);
    expect(middle.getConditionalOutgoingDamageBonus('p')).toBe(0);
    expect(high.getConditionalOutgoingDamageBonus('p')).toBeCloseTo(0.08, 10);
  });

  it('gibt Nicht-Spielern keinen Bonus', () => {
    // Ein Turm hat kein HP-Verhaeltnis; ohne diese Pruefung erhielte er dauerhaft "Unversehrt".
    const system = build({ affixes: { high_hp_damage: 0.08 }, hp: {} });
    expect(system.getConditionalOutgoingDamageBonus('turm')).toBe(0);
    expect(system.getConditionalOutgoingDamageBonus(undefined)).toBe(0);
  });

  it('gibt den festen Lifeleech-Zuschlag nur unter der Schwelle', () => {
    const affixes = { low_hp_blood_rage: 0.12 };
    expect(build({ affixes, hp: { p: { hp: 39, maxHp: 100 } } }).getConditionalLifeLeechBonus('p'))
      .toBeCloseTo(COOP_DEFENSE_AFFIX_RULES.bloodRageLifeLeechBonus, 10);
    expect(build({ affixes, hp: { p: { hp: 41, maxHp: 100 } } }).getConditionalLifeLeechBonus('p')).toBe(0);
    // Ohne Blutrausch gibt es auch bei niedrigen HP keinen Zuschlag.
    expect(build({ hp: { p: { hp: 5, maxHp: 100 } } }).getConditionalLifeLeechBonus('p')).toBe(0);
  });

  it('gibt Letzte Bastion nur unter der Schwelle', () => {
    const affixes = { low_hp_damage_reduction: 0.09 };
    expect(build({ affixes, hp: { p: { hp: 30, maxHp: 100 } } }).getConditionalDamageReduction('p'))
      .toBeCloseTo(0.09, 10);
    expect(build({ affixes, hp: { p: { hp: 40, maxHp: 100 } } }).getConditionalDamageReduction('p')).toBe(0);
  });
});

describe('Bewegungsaffixe', () => {
  it('stapelt Nachbrenner nicht, erneuert aber die Dauer', () => {
    const system = build({ affixes: { dash_speed: 0.15 } });
    system.initPlayer('p', 0);

    system.registerDashCompleted('p', 1_000);
    system.registerDashCompleted('p', 1_100);
    // Zweimal gedasht, trotzdem nur einmal der Bonus.
    expect(system.getRunSpeedMultiplier('p', 1_200)).toBeCloseTo(1.15, 10);
    // Die Dauer laeuft ab dem zweiten Dash.
    const stillActive = 1_100 + COOP_DEFENSE_AFFIX_RULES.afterburnerDurationMs - 1;
    expect(system.getRunSpeedMultiplier('p', stillActive)).toBeCloseTo(1.15, 10);
    expect(system.getRunSpeedMultiplier('p', 1_100 + COOP_DEFENSE_AFFIX_RULES.afterburnerDurationMs)).toBe(1);
  });

  it('addiert Unter Druck und Nachbrenner', () => {
    const system = build({
      affixes: { dash_speed: 0.15, low_hp_speed: 0.12 },
      hp: { p: { hp: 20, maxHp: 100 } },
    });
    system.initPlayer('p', 0);
    system.registerDashCompleted('p', 0);
    expect(system.getRunSpeedMultiplier('p', 100)).toBeCloseTo(1.27, 10);
  });

  it('speichert hoechstens eine kinetische Ladung', () => {
    const system = build({ affixes: { movement_charge_damage: 0.2 } });
    system.initPlayer('p', 0);

    // Weit ueber zwei Ladungen an Strecke, in Schritten unter der Teleport-Klemme.
    let x = 0;
    system.trackMovement('p', 0, 0);
    for (let step = 0; step < 60; step++) {
      x += 40;
      system.trackMovement('p', x, 0);
    }
    expect(system.hasMovementCharge('p')).toBe(true);
    expect(system.consumeMovementCharge('p')).toBeCloseTo(0.2, 10);
    // Die zweite Ladung wurde nicht zusaetzlich gespeichert.
    expect(system.hasMovementCharge('p')).toBe(false);
    expect(system.consumeMovementCharge('p')).toBe(0);
  });

  it('laedt nicht durch Teleports', () => {
    const system = build({ affixes: { movement_charge_damage: 0.2 } });
    system.initPlayer('p', 0);
    system.trackMovement('p', 0, 0);
    // Ein einzelner Sprung quer durch die Arena – deutlich mehr als die benoetigte Strecke.
    system.trackMovement('p', 4_000, 0);
    expect(system.hasMovementCharge('p')).toBe(false);
    expect(system.getMovementChargeProgress('p')).toBe(0);
  });

  it('verbraucht die Ladung auch bei einem verfehlten Schuss', () => {
    const system = build({ affixes: { movement_charge_damage: 0.2 } });
    system.initPlayer('p', 0);
    system.trackMovement('p', 0, 0);
    for (let step = 1; step <= 20; step++) system.trackMovement('p', step * 30, 0);

    expect(system.hasMovementCharge('p')).toBe(true);
    // Der Aufrufer verbraucht beim Feuern, nicht beim Treffen – Treffer spielen hier keine Rolle.
    system.consumeMovementCharge('p');
    expect(system.getMovementChargeProgress('p')).toBe(0);
  });
});

describe('Neue Positions-Affixe', () => {
  it('loest Glutwanderer nach echter Strecke aus und bewahrt Reststrecke', () => {
    const system = build({ affixes: { glutwanderer: 3.8 } });
    system.initPlayer('p', 0);
    system.trackMovement('p', 0, 0);

    let bursts = 0;
    for (let step = 1; step <= 8; step += 1) {
      bursts += system.trackMovement('p', step * 64, 0);
    }
    expect(bursts).toBe(1);
    expect(system.getGlutwandererChunkCount('p')).toBe(3);
    expect(system.getGlutwandererProgress('p')).toBeCloseTo((8 * 64 - 500) / 500, 10);

    const second = system.trackMovement('p', 8 * 64 + 64, 0);
    expect(second).toBe(0);
    expect(system.getGlutwandererProgress('p')).toBeCloseTo((9 * 64 - 500) / 500, 10);
  });

  it('zaehlt Teleports weder fuer Glutwanderer noch fuer die vorhandene Bewegungsladung', () => {
    const system = build({ affixes: { glutwanderer: 3, movement_charge_damage: 0.2 } });
    system.initPlayer('p', 0);
    system.trackMovement('p', 0, 0);
    expect(system.trackMovement('p', 4_000, 0)).toBe(0);
    expect(system.getGlutwandererProgress('p')).toBe(0);
    expect(system.getMovementChargeProgress('p')).toBe(0);
  });

  it('haelt Umzingelt waehrend der Nachlaufzeit aktiv und addiert sich mit Kampfaufladung', () => {
    const system = build({
      affixes: { surrounded: 0.12, adrenaline_kill_charge: 0.03 },
    });
    system.initPlayer('p', 0);
    const enemies = Array.from({ length: 5 }, (_, index) => ({ x: index * 10, y: 0 }));
    system.updateSurrounded('p', 0, 0, enemies, 1_000);
    system.registerOwnKill('p', 1_000);
    expect(system.isSurrounded('p', 1_000)).toBe(true);
    expect(system.getAdrenalineRegenMultiplier('p', 1_000)).toBeCloseTo(1.15, 10);

    system.updateSurrounded('p', 0, 0, [], 1_001);
    expect(system.isSurrounded('p', 1_000 + COOP_DEFENSE_AFFIX_RULES.surroundedLingerMs - 1)).toBe(true);
    expect(system.isSurrounded('p', 1_001 + COOP_DEFENSE_AFFIX_RULES.surroundedLingerMs)).toBe(false);
  });

  it('ueberspringt den Gegner-Iterator, wenn kein Spieler Umzingelt traegt', () => {
    const system = build();
    let enemyVisits = 0;
    system.updateSurroundedPlayers(
      [{ id: 'p', sprite: { x: 0, y: 0 } }],
      { forEachEnemy: () => { enemyVisits += 1; } },
      () => true,
      () => true,
      1_000,
    );
    expect(enemyVisits).toBe(0);
  });

  it('verwendet fuer mehrere Traeger nur einen gemeinsamen Gegner-Scan', () => {
    const system = build({ affixes: { surrounded: 0.12 } });
    const enemies = Array.from({ length: COOP_DEFENSE_AFFIX_RULES.surroundedEnemyCount }, (_, index) => ({
      id: `e${index}`,
      sprite: { active: true, x: index * 8, y: 0 },
    }));
    let enemyVisits = 0;
    system.updateSurroundedPlayers(
      [
        { id: 'p0', sprite: { x: 0, y: 0 } },
        { id: 'p1', sprite: { x: 24, y: 0 } },
      ],
      {
        forEachEnemy: (visit) => {
          for (const enemy of enemies) {
            enemyVisits += 1;
            visit(enemy);
          }
        },
      },
      () => true,
      () => true,
      1_000,
    );
    expect(enemyVisits).toBe(COOP_DEFENSE_AFFIX_RULES.surroundedEnemyCount);
    expect(system.isSurrounded('p0', 1_000)).toBe(true);
    expect(system.isSurrounded('p1', 1_000)).toBe(true);
  });

  it('waehlt bei Fernsteuerung das naechste eigene Konstrukt stabil nach ID', () => {
    const sources = [
      { id: 8, x: 10, y: 0, ownerId: 'p', ownerColor: 0xff00aa },
      { id: 2, x: -10, y: 0, ownerId: 'p', ownerColor: 0xff00aa },
      { id: 1, x: 0, y: 0, ownerId: 'other', ownerColor: 0x00ffaa },
    ];
    const system = build({
      affixes: { remote_control: 0.15 },
      positions: { p: { x: 0, y: 0 } },
      classIds: { p: 'inspector_gadachs' },
    });

    expect(system.getRemoteControlTarget('p', sources)?.id).toBe(2);
    expect(system.getRemoteControlDamageMultiplier('p', sources[1], sources)).toBeCloseTo(1.15, 10);
    expect(system.getRemoteControlDamageMultiplier('p', sources[0], sources)).toBe(1);
    expect(system.getRemoteControlSnapshot(['p'], sources)).toEqual([{
      turretId: '2', ownerId: 'p', x: -10, y: 0, color: 0xff00aa,
    }]);
  });

  it('macht Fernsteuerung ohne Inspector-Klasse oder ohne Affix wirkungslos', () => {
    const source = { id: 1, x: 0, y: 0, ownerId: 'p', ownerColor: 0xffffff };
    const wrongClass = build({
      affixes: { remote_control: 0.15 },
      positions: { p: { x: 0, y: 0 } },
      classIds: { p: 'dachs_of_steel' },
    });
    expect(wrongClass.getRemoteControlTarget('p', [source])).toBeNull();

    const noAffix = build({
      positions: { p: { x: 0, y: 0 } },
      classIds: { p: 'inspector_gadachs' },
    });
    expect(noAffix.getRemoteControlDamageMultiplier('p', source, [source])).toBe(1);
  });
});

describe('Primaerwaffen-Treffereffekte', () => {
  it('belegt bei erfolgreichem Wurf mit Verwundbarkeit und stapelt sie nicht', () => {
    const system = build({ affixes: { primary_vulnerability: 1 }, rolls: [0] });
    const bonus = 1 + COOP_DEFENSE_AFFIX_RULES.vulnerabilityBonus;

    system.rollDirectPrimaryHitEffects('p', 'gegner', 1_000);
    expect(system.getEnemyIncomingDamageMultiplier('gegner', 1_000)).toBeCloseTo(bonus, 10);

    // Erneute Ausloesung verlaengert nur, sie verstaerkt nicht.
    system.rollDirectPrimaryHitEffects('p', 'gegner', 2_000);
    expect(system.getEnemyIncomingDamageMultiplier('gegner', 2_000)).toBeCloseTo(bonus, 10);
    expect(system.getEnemyIncomingDamageMultiplier(
      'gegner',
      2_000 + COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs,
    )).toBe(1);
  });

  it('laesst einen unmarkierten Gegner unveraendert', () => {
    const system = build({ affixes: { primary_vulnerability: 0 }, rolls: [0] });
    system.rollDirectPrimaryHitEffects('p', 'gegner', 0);
    expect(system.getEnemyIncomingDamageMultiplier('gegner', 0)).toBe(1);
    expect(system.getVulnerableEnemiesSnapshot(0)).toEqual([]);
  });

  it('repliziert einen absoluten Ablaufzeitpunkt', () => {
    const system = build({ affixes: { primary_vulnerability: 1 }, rolls: [0] });
    system.rollDirectPrimaryHitEffects('p', 'gegner', 5_000);
    expect(system.getVulnerableEnemiesSnapshot(5_000)).toEqual([
      { enemyId: 'gegner', expiresAt: 5_000 + COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs },
    ]);
    // Abgelaufene Eintraege verlassen den Snapshot.
    expect(system.getVulnerableEnemiesSnapshot(
      5_000 + COOP_DEFENSE_AFFIX_RULES.vulnerabilityDurationMs,
    )).toEqual([]);
  });

  it('meldet die Verlangsamung nur bei erfolgreichem Wurf', () => {
    const hit = build({ affixes: { primary_slow: 0.5 }, rolls: [0.4] });
    expect(hit.rollDirectPrimaryHitEffects('p', 'gegner', 0)).toEqual({
      slowFraction: COOP_DEFENSE_AFFIX_RULES.suppressionSlowFraction,
      slowDurationMs: COOP_DEFENSE_AFFIX_RULES.suppressionSlowDurationMs,
    });

    const miss = build({ affixes: { primary_slow: 0.5 }, rolls: [0.6] });
    expect(miss.rollDirectPrimaryHitEffects('p', 'gegner', 0).slowFraction).toBe(0);
  });
});

describe('Hinrichtung', () => {
  const threshold = COOP_DEFENSE_AFFIX_RULES.cullingHpThreshold;

  it('greift nur unterhalb der HP-Schwelle', () => {
    const system = build({ affixes: { primary_culling: 1 }, rolls: [0] });
    expect(system.rollCulling('p', 100 * threshold - 1, 100, false)).toBe(true);
    expect(system.rollCulling('p', 100 * threshold, 100, false)).toBe(false);
    expect(system.rollCulling('p', 90, 100, false)).toBe(false);
  });

  it('verschont Bosse vollstaendig', () => {
    const system = build({ affixes: { primary_culling: 1 }, rolls: [0] });
    expect(system.rollCulling('p', 1, 100, true)).toBe(false);
  });

  it('greift nicht bei einem bereits toten oder geretteten Gegner', () => {
    // `lethalDamageGuard` meldet einen geretteten Gegner mit `remainingHp === 0`.
    const system = build({ affixes: { primary_culling: 1 }, rolls: [0] });
    expect(system.rollCulling('p', 0, 100, false)).toBe(false);
  });

  it('bleibt ohne das Affix aus', () => {
    const system = build({ rolls: [0] });
    expect(system.rollCulling('p', 1, 100, false)).toBe(false);
  });
});

describe('Brandzerfall', () => {
  it('folgt der gewuerfelten Chance', () => {
    expect(build({ affixes: { primary_kill_fire_chunks: 0.5 }, rolls: [0.4] }).rollFireChunksOnKill('p')).toBe(true);
    expect(build({ affixes: { primary_kill_fire_chunks: 0.5 }, rolls: [0.5] }).rollFireChunksOnKill('p')).toBe(false);
    expect(build({ rolls: [0] }).rollFireChunksOnKill('p')).toBe(false);
  });

  it('legt genau drei Brocken fest', () => {
    expect(COOP_DEFENSE_AFFIX_RULES.fireChunkCount).toBe(3);
  });
});

describe('Lifecycle', () => {
  it('haelt nach dem Rundenende keinen Spieler- oder Gegnerzustand mehr', () => {
    const system = build({ affixes: { adrenaline_kill_charge: 0.03, primary_vulnerability: 1 }, rolls: [0] });
    system.initPlayer('p', 0);
    system.registerOwnKill('p', 0);
    system.rollDirectPrimaryHitEffects('p', 'gegner', 0);

    system.clear();
    expect(system.getKillChargeStacks('p', 0)).toBe(0);
    expect(system.getEnemyIncomingDamageMultiplier('gegner', 0)).toBe(1);
    expect(system.getVulnerableEnemiesSnapshot(0)).toEqual([]);
    expect(system.hasMovementCharge('p')).toBe(false);
  });

  it('vergisst einen entfernten Gegner sofort', () => {
    const system = build({ affixes: { primary_vulnerability: 1 }, rolls: [0] });
    system.rollDirectPrimaryHitEffects('p', 'gegner', 0);
    system.removeEnemy('gegner');
    expect(system.getEnemyIncomingDamageMultiplier('gegner', 0)).toBe(1);
  });
});
