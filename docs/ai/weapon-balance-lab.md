# Weapon-Balance-Lab

## Geltungsbereich

Das Balance-Lab ist ein Debug- und Analysepfad für Waffen, Upgrades und Szenarien. Es liefert Mess- und Vergleichsdaten, aber keine Gameplay-Autorität und keinen Ersatz für die produktive Loadout- oder Combat-Implementierung.

## Gemeinsame Vertragsbasis

Ein Lab-Szenario muss seine versionierte Identität, Loadout-/Upgrade-Konfiguration, Capability-Annahmen, Zielkonfiguration, Seed und Zeit-/Trigger-Modell explizit tragen. Headless- und Runtime-Harness dürfen dieselbe aufgelöste fachliche Waffenlogik verwenden; ein Lab-Shortcut darf keinen stillen Produktionsunterschied einführen.

[WeaponBalanceLabRuntime.ts](../../src/debug/coopDefenseBalance/WeaponBalanceLabRuntime.ts), [HeadlessSingleTargetWorld.ts](../../src/debug/coopDefenseBalance/HeadlessSingleTargetWorld.ts) und [HeadlessStaticTargetWorld.ts](../../src/debug/coopDefenseBalance/HeadlessStaticTargetWorld.ts) sind Analyse-Einstiegspunkte. [weaponCapabilityValidator.ts](../../src/debug/coopDefenseBalance/weaponCapabilityValidator.ts) prüft, ob ein Build die geforderten Fähigkeiten und Annahmen überhaupt erfüllt.

## Reproduzierbare Messung

Vergleiche sind nur sinnvoll, wenn Szenarioidentität, Seed, Simulationszeit, Trigger-Disziplin, Zielzustand und Ausgabefenster gleich bleiben. Die Messung soll die Fachzeit des Harness verwenden und darf nicht durch lokale Renderzeit, Date.now oder UI-Timing verzerrt werden.

Cache-Schlüssel, Benchmark-Storage und Reports müssen die Szenarioidentität mitführen. Ergebnisse werden als Diagnoseartefakt behandelt; sie ändern weder authored Balance noch laufenden Multiplayer-Zustand automatisch.

## Test- und Config-Parität

`npm run test:balance-lab` ist die bewusste Ausnahme zur normalen Tuning-Regel: Werkzeug-,
Progressions- und Benchmarktests dürfen ihre Ergebnisse gegen die aktuell aufgelöste Config
prüfen. Core-Tests sollen dieselben HP-, Damage-, Cooldown- oder Progressionswerte nicht als
zweite Wahrheit wiederholen. Änderungen am Lab bleiben Diagnose- und Teständerungen; sie ändern
nicht automatisch die produktive Balance.

## Erweiterungen

Bei einer neuen Waffe oder einem Upgrade zuerst die produktive Content-/Capability-Auflösung prüfen und dann die kleinste Lab-Szenarioerweiterung ergänzen. Keine Karte, kein Gegnerwert und kein historischer Benchmarkstand gehört in diese Seite. Eine neue Messgröße braucht einen reproduzierbaren Owner und einen Test, nicht nur eine Dokumentationszahl.

## Maßgebliche Quellen

- [src/debug/coopDefenseBalance/index.ts](../../src/debug/coopDefenseBalance/index.ts)
- [src/debug/coopDefenseBalance/scenarioTypes.ts](../../src/debug/coopDefenseBalance/scenarioTypes.ts)
- [src/debug/coopDefenseBalance/scenarioCacheKey.ts](../../src/debug/coopDefenseBalance/scenarioCacheKey.ts)
- [src/debug/coopDefenseBalance/runtimeBenchmarkStorage.ts](../../src/debug/coopDefenseBalance/runtimeBenchmarkStorage.ts)
- [tests/balance-lab/WeaponBalanceLabRuntime.test.ts](../../tests/balance-lab/WeaponBalanceLabRuntime.test.ts)
- [tests/balance-lab/CoopDefenseBalanceLab.test.ts](../../tests/balance-lab/CoopDefenseBalanceLab.test.ts)
