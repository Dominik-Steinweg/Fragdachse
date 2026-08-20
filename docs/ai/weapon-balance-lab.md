# Weapon Balance Lab – Architekturvertrag

## Szenario und Messsemantik

Der statische Single-Target-Benchmark verwendet versionierte Profile aus
`src/debug/coopDefenseBalance/scenarioTypes.ts`. Das kanonische Fernkampfprofil ist
`single_target_static.v1` mit festem Zielradius, fester Distanz, Warmup-, Measurement- und
Settle-Zeit sowie expliziten Aim-/Trigger-Policies. Nahkampf nutzt das ebenfalls versionierte
`MELEE_SINGLE_TARGET_SCENARIO_CONFIG`; keine Distanz wird aus Weapon-Range rekonstruiert.

Das Measurement Window ist halboffen: `[measurementStartMs, measurementEndMs)`. Nur
Schadensereignisse in diesem Intervall bilden `totalDamage`, `directDamage`, `burnDamage` und
ST-DPS. Dieselbe Grenze gilt für die primären Rate-Zähler `shotsFired`, Target-/Projectile-Hits
und Adrenalin-Generierung beziehungsweise -Verbrauch; Warmup- und Settle-Werte bleiben als
Diagnose erhalten. Warmup- und Settle-Schaden werden zusätzlich über `damageYieldIncludingTail`
beziehungsweise die Tail-Felder ausgewiesen.

`primaryMetricComplete` und `tailComplete` sind getrennte Zustände. Ein vollständig verarbeitetes
Measurement Window bleibt für DPS-Auswertung und `provenMaximum` gültig, auch wenn die optionale
Settle-Diagnose (`settleTruncated`) noch aktive Burn-/Projectile-Effekte abschneidet.

V0.9 ergänzt das versionierte Profil `five_target_static.v1` sowie das explizite
`MELEE_FIVE_TARGET_SCENARIO_CONFIG`. `generateFiveTargetLayout` erzeugt daraus fünf stabile,
spieler-große, unsterbliche Targets mit IDs `target_1` bis `target_5`. Die Geometrie ist von
WeaponConfig, Upgrades und Range unabhängig; Range entscheidet nur, welche vorhandenen Targets
erreichbar sind. Benchmark-Seeds werden stabil in getrennte Layout- und Weapon-RNG-Seeds
abgeleitet.

## Gemeinsame Regeln

- `WeaponFireExecutor` übersetzt WeaponConfig in dieselben Fire-Requests für Runtime und Lab.
- `ShotPlanResolver` ist die gemeinsame Quelle für Schusswinkel, Pellets und Spread.
- `DirectCombatHitResolver` und `ProjectileImpactResolver` teilen die reine Treffergeometrie.
- `BurnStateMachine` ist die gemeinsame Quelle für Brand-Stacks, Tick-Zeitpunkte und Expiration.
- `weaponBalanceCapabilities.ts` beschreibt zentral, welche Mechaniken pro Szenario `supported`,
  `scenario_irrelevant` oder `unsupported_relevant` sind. Validator und Payload-Guard konsumieren
  diesen Katalog; unbekannte aktive Felder werden fail-closed abgelehnt.

## Bewusst headless-spezifische Regeln

`HeadlessStaticTargetWorld` ist der gemeinsame statische Headless-Kern für Single Target und Five
Target; `HeadlessSingleTargetWorld` bleibt nur als kompatibler Single-Target-Wrapper bestehen.
Virtuelle Zeit, Projectile-Scheduling inklusive Lifetime-Grenze, Measurement Window,
Resource-Recording, Burn, Hitscan, Melee, Fire Sink und Payload-Validation werden nicht dupliziert.
Bei mehreren Targets gewinnt der räumlich/früheste Treffer, bei gleicher Distanz deterministisch
die kleinere Target-ID; ein normaler Melee-Swing darf mehrere Targets treffen.

Renderobjekte, Netzwerk, Arena-Hindernisse, VFX und Runtime-Callbacks bleiben außerhalb.
Projektilflug-Sondermechaniken wie Homing, Explosionen, Piercing, Splits und Detonationen werden
nicht im Headless-Pfad nachgebaut; der Capability-Katalog klassifiziert sie für relevante
Szenarien fail-closed als `unsupported_relevant`.

## Sichere nächste Erweiterungen

Als Nächstes können reine Domain-Resolver für `RadialDamageResolver`, Penetration, Homing oder
Splits schrittweise aus dem Runtime-Pfad extrahiert werden. Jede Erweiterung braucht eine
Capability-Definition, Payload-Klassifikation und Runtime-/Headless-Paritätstests, bevor sie im
Benchmark als unterstützt gilt.
