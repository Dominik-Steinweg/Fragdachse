# Weapon Balance Lab – Architekturvertrag

## Szenario und Messsemantik

Der statische Single-Target-Benchmark verwendet versionierte Profile aus
`src/debug/coopDefenseBalance/scenarioTypes.ts`. Das kanonische Fernkampfprofil ist
`single_target_static.v1` mit festem Zielradius, fester Distanz, Warmup-, Measurement- und
Settle-Zeit sowie expliziten Aim-/Trigger-Policies. Nahkampf nutzt das ebenfalls versionierte
`MELEE_SINGLE_TARGET_SCENARIO_CONFIG`; keine Distanz wird aus Weapon-Range rekonstruiert.

Das Measurement Window ist halboffen: `[measurementStartMs, measurementEndMs)`. Nur
Schadensereignisse in diesem Intervall bilden `totalDamage`, `directDamage`, `burnDamage` und
ST-DPS. Warmup- und Settle-Schaden bleiben im Event-Log und werden zusätzlich über
`damageYieldIncludingTail` beziehungsweise die Tail-Felder ausgewiesen.

## Gemeinsame Regeln

- `WeaponFireExecutor` übersetzt WeaponConfig in dieselben Fire-Requests für Runtime und Lab.
- `ShotPlanResolver` ist die gemeinsame Quelle für Schusswinkel, Pellets und Spread.
- `DirectCombatHitResolver` und `ProjectileImpactResolver` teilen die reine Treffergeometrie.
- `BurnStateMachine` ist die gemeinsame Quelle für Brand-Stacks, Tick-Zeitpunkte und Expiration.
- `weaponBalanceCapabilities.ts` beschreibt zentral, welche Mechaniken pro Szenario `supported`,
  `scenario_irrelevant` oder `unsupported_relevant` sind. Validator und Payload-Guard konsumieren
  diesen Katalog; unbekannte aktive Felder werden fail-closed abgelehnt.

## Bewusst headless-spezifische Regeln

`HeadlessSingleTargetWorld` besitzt nur virtuelle Zeit, Simulations-Entities, den statischen Dummy,
Event-Aufzeichnung und Orchestrierung. Renderobjekte, Netzwerk, Arena-Hindernisse, VFX und
Runtime-Callbacks bleiben außerhalb. Projektilflug-Sondermechaniken wie Homing, Explosionen,
Piercing, Splits und Detonationen werden nicht im Headless-Pfad nachgebaut; sie werden erst nach
Extraktion eines gemeinsamen reinen Resolvers in beiden Pfaden ergänzt.

## Sichere nächste Erweiterungen

Als Nächstes können reine Domain-Resolver für `RadialDamageResolver`, Penetration, Homing oder
Splits schrittweise aus dem Runtime-Pfad extrahiert werden. Jede Erweiterung braucht eine
Capability-Definition, Payload-Klassifikation und Runtime-/Headless-Paritätstests, bevor sie im
Benchmark als unterstützt gilt.
