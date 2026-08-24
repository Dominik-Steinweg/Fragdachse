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

## V0.10 – Aim- und Chain-Lightning-Vertrag

`resolveFiveTargetAim()` löst seine Trigger-Grenze aus der tatsächlich gewählten Aim-Lösung:
Einzel-Projektile/Hitscans wählen ein geometrisch geeignetes erreichbares Ziel, Pellet-Aims die
reale Pellet-Coverage und deren strengste Accuracy-Grenze, Melee die gewählte Multi-Hit-Menge.
Die Auswahl ist unabhängig von der Target-Array-Reihenfolge; Geometrie kommt vor der ID als
letztem deterministischem Tie-Breaker. Die fünf kanonischen Szenario-Profile bleiben
`single_target_static.v1` und `five_target_static.v1`.

Der allgemeine Chain-Lightning-Traversal-/Damage-Resolver liegt in
`src/combat/rules/ChainLightningResolver.ts`. Die einzige geänderte Runtime-Datei ist
`src/systems/CombatSystem.ts`; sie liefert weiterhin Kandidaten, Sichtlinie, Zielregeln und
Folgeeffekte. Vor und nach dem Extract gelten unverändert: Start am erfolgreichen primären
Hitscan-Aufschlagspunkt, `floor(maxJumps)`, 1-basierter Sprung-Falloff, Suchradius,
bereits getroffene Ziele, Kandidatenreihenfolge Enemy → Player → Decoy → Detonable und der
aktuelle first-encountered-Tie bei gleicher Distanz. Chain-Schaden läuft weiter als
`damageKind: 'chain'` durch `applyDamage` ohne `sourceSlot`; der direkte Primärschaden behält
seine normalen Multiplikatoren, Crit-Default und Primärtreffer-Affixe, während Chain-Jumps
keine Direct-Primary-Hit-Affixe auslösen. Die bisherige Resource-Semantik pro gültigem
Enemy-/Player-/Decoy-Chain-Treffer bleibt erhalten; Detonables verursachen keinen Chain-Schaden.
`tests/ChainLightningResolverCharacterization.test.ts` und
`tests/CombatSystemChainLightningParity.test.ts` sichern diese Parität.

Im statischen Five-Target-Profil werden die Dummies als Enemy-Kandidaten ohne LoS-Blocker
eingespeist. Der Primärtreffer bleibt `direct`, Chain-Ereignisse werden separat als
`chainDamage`/`chainDps` aggregiert; im Single-Target-Profil ist Chain weiterhin
`scenario_irrelevant`. `shotgunChain` bleibt absichtlich `unsupported_relevant`.

Renderobjekte, Netzwerk, Arena-Hindernisse, VFX und Runtime-Callbacks bleiben außerhalb.
Projektilflug-Sondermechaniken wie Homing, Explosionen, Piercing, Splits und Detonationen werden
nicht im Headless-Pfad nachgebaut; der Capability-Katalog klassifiziert sie für relevante
Szenarien fail-closed als `unsupported_relevant`.

## Balance Lab 2.0 – interner Runtime-Schießstand

Der Runtime-Schießstand ist eine bewusst manuell bediente Zwischenstufe neben dem Headless-Lab.
`weapon-balance-lab` wird als interne Coop-Defense-Map aufgelöst, bleibt aber aus
`COOP_DEFENSE_MAP_CONFIGS`, Kampagnen-Audit, Freischaltungen und normaler Map-Auswahl ausgeschlossen.
Ein Solo-Host öffnet die Steuerung in der Coop-Lobby mit `F8`; der Start läuft über den normalen
Ready-, Arena-Build- und Round-Lifecycle. Nach der Messung wird die Diagnose-Runde ohne Ergebnis,
Fortschritt oder Raumstatistik verworfen und die vorher ausgewählte Map wiederhergestellt.

`WeaponBalanceLabRuntime` ist nur Szenario- und Input-Controller. Es setzt Spieler und unsterbliche,
statische `zombie-badger`-Targets, ruft den echten `LoadoutManager.use`-Pfad auf und lässt
Projectile-, Combat-, Burn-, Spezialwaffen- und Resource-Systeme unverändert arbeiten. Normale
Waves, Mission-Fortschritt, Gegnerbewegung und Gegnerangriffe bleiben auf der internen Map
angehalten. Der Mess-Build behält ausschließlich den gewählten W1- oder W2-Upgrade-Ast; Klasse,
Items, allgemeine Upgrades, Werkzeuge und der ungemessene Loadout-Teil bleiben neutral.

Die auswählbaren ST-/5T-Runs dieser Zwischenstufe verwenden eine manuelle Distanz und eine feste
Runtime-Formation. Sie tragen deshalb noch keinen automatischen Paritätsanspruch zu
`single_target_static.v1` beziehungsweise `five_target_static.v1`; ein solcher Vergleich muss
Distanz, Geometrie, Zeitfenster und Trigger-Policy explizit angleichen.

Der primäre Runtime-Zeitraum ist ebenfalls halboffen: `[warmupMs, warmupMs + measurementMs)`.
Passive Observer an `CombatSystem` und `ResourceSystem` erfassen tatsächlich verlorene HP,
Damage-Kind, Crit-Ereignisse sowie tatsächlich gutgeschriebenes oder abgezogenes Adrenalin.
Settle-Schaden bleibt separat; noch aktive eigene Projektile oder Brandquellen markieren den Tail
als `truncated`. Ergebnisse werden lokal als versionierte Runtime-Runs gespeichert und als JSON
oder CSV exportiert. Die UI gruppiert nur unmittelbar vergleichbare Runs nach Waffe, Slot,
Szenario, Zielzahl, Distanz, Messdauer und Build und bezeichnet den höchsten Messwert ausdrücklich
als `Best observed`, nicht als `provenMaximum`.

## Sichere nächste Erweiterungen

Als Nächstes können reine Domain-Resolver für `RadialDamageResolver`, Penetration, Homing oder
Splits schrittweise aus dem Runtime-Pfad extrahiert werden. Jede Erweiterung braucht eine
Capability-Definition, Payload-Klassifikation und Runtime-/Headless-Paritätstests, bevor sie im
Benchmark als unterstützt gilt.
