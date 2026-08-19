# Gameplay

Gameplay-Regeln liegen in src/systems/, die Modus-IDs und gemeinsamen Verträge in src/types.ts und src/gameModes.ts. Aktuelle Balancewerte gehören in Code/JSON, nicht in diese Seite.

## Phasen

GamePhase kennt nur LOBBY und ARENA.

- In der Lobby verwaltet der Host Modus, Map, Teams, Loadouts, Ready und Raumqualität; der Client zeigt den replizierten Stand.
- In der Arena läuft zunächst ein eigenständiger schwarzer Ladeabschnitt ohne sichtbare Arena, Countdown, Input, Gameplay- oder Round-Timer-Fortschritt. Für jeden eingefrorenen Teilnehmer werden Name, Stufe, Prozent und Ready-Status angezeigt. Jeder Peer meldet erst nach vollständigem Aufbau seines initialen Working-Sets ein eigenes `ArenaLoadReadyState`; danach beginnt unmittelbar die gemeinsame Countdown-/Startphase und erst am autoritativen `arenaStartTime` die host-autoritativ aufgebaute Simulation. Round-Systeme existieren nur während dieser Phase.
- ArenaLifecycleCoordinator führt Start, Ende und Rückkehr zur Lobby aus. RoundState beziehungsweise RoundResult sind replizierte Ergebnisse, keine dritte Netzwerkphase. Ergebnis- und Progressions-Overlays bleiben lokale Darstellung.

Ein Host startet nur mit erfüllten Ready-/Loadout- und Modusbedingungen. Vorzeitige Abschlüsse laufen über hostCompleteRound() und verwenden den definierten RoundConclusion-Vertrag. Rewards und Freischaltungen prüfen ihre Eligibility getrennt vom sichtbaren Overlay.

## Modi

Die vier IDs sind deathmatch, team_deathmatch, capture_the_beer und coop_defense.

- Deathmatch ist frei für alle; Team Deathmatch und Capture the Beer verwenden gegnerische Teams.
- Capture the Beer nutzt die erweiterte Arena und eine dynamische Kamera.
- Coop Defense verwendet ein gemeinsames Team, hostseitige PvE-Systeme und map-authored Ziele.

Gemeinsame Kernpfade für Spieler, Combat, Projektile, Ressourcen und Loadouts bleiben mode-agnostisch. Mode-spezifische Systeme werden in der Round-Verdrahtung erzeugt; keine dauerhaften Coop-Sonderfälle in allgemeine Systeme einbauen.

## Participation und Spectator

NetworkBridge.hostStartRoundParticipants() friert die Teilnehmer beim Rundenstart ein. Später beitretende Spieler und Spieler nach freiwilligem Wechsel werden host-autoritativ Spectators. canPlayerSpawnOrRespawn(), canPlayerAct() und canPlayerReceiveRoundRewards() sind die gemeinsamen Gates.

Die Participation-Revision und `arenaLoadReady` gehören zur technischen Startbarriere und ersetzen nicht das Lobby-Ready. Disconnects werden aus der aktuellen Teilnehmerprüfung entfernt; ein später beitretender Spectator setzt einen bereits geplanten Start nicht zurück. Ein vorbereiteter Rundenzustand bleibt bis zum gemeinsamen Startzeitpunkt verborgen.

Eine Survival-Eliminierung ändert nicht automatisch die Netzwerkrolle: Der Spieler bleibt Reward-Teilnehmer, kann aber lokal keine Aktionen mehr ausführen und wird spectator-like dargestellt. Beim nächsten Rundenwechsel wird der Participation-Snapshot gelöscht.

## Coop-Zielgrenzen

Coop-Sieg und -Niederlage gehören ausschließlich CoopDefenseRoundStateSystem und den authored Objective-Verträgen. CoopDefenseSurvivalSystem, CoopDefenseMapDirector, CoopDefenseBossSystem, CoopDefensePersistentPressureSystem und CoopDefenseMapEventDirector liefern jeweils nur ihren fachlichen Input.

Survival ist explizit: Maps mit objective: "survive" müssen Dauer und begrenzte persönliche Respawns authoren. Andere Coop-Ziele dürfen keinen impliziten Rundentimer aus einer Balance-Referenz ableiten.

Nebenmissionen sind optionale, nicht siegrelevante Ziele mit den Archetypen destroy, hold und carry. Ihre authored Konfiguration, Lebenszyklus und Rewards gehören in coop-defense-authoring.md; die Netzrolle bleibt host-autoritativ.

## Gameplay-Grenzen

- Der Host ist die einzige Instanz für Schaden, Spawn, Ressourcenverbrauch und Sieg/Niederlage.
- Raumweite Schadensstatistiken werden im zentralen CombatSystem nur aus tatsächlich verlorenen HP/Rüstung beziehungsweise Gegner-HP gespeist; Overkill, Selbst-, Freund-, Umwelt-, Fels- und Zugschaden bleiben ausgeschlossen. Spielerbesitz von Folgeeffekten wird vor der hostseitigen Anrechnung aufgelöst.
- Waffenaktionen beanspruchen hostseitig exklusiv ihren Slot, bevor Cooldown oder Ressource geprüft werden; der Wechsel beendet den nicht-autonomen gehaltenen/kanalisierten Effekt des anderen Slots sofort. Explizit autonome Toggle-Upgrades bleiben davon ausgenommen.
- Trefferherkunft wird über typisierte Damage-/Slot-Felder geführt, nicht über Anzeigenamen oder Rendererzustand.
- Loadout- und Upgrade-Regeln gehören in Resolver und Systems. Neue Stats müssen über den gemeinsamen Host-/Client-Resolver laufen, damit Anzeige und Gate identisch bleiben.
- Strategische Ziele und Navigation verwenden die vorhandenen Flowfield-/Obstacle-Services. Keine zweite Sichtlinien- oder Zielquellenliste neben den zentralen Services einführen. Sichtbare Coop-Gleise bleiben passierbar: Querbewegung nutzt die moderate Gleiskostenklasse, ein Schritt laengs von Gleiszelle zu Gleiszelle einen zentral konfigurierten Zusatzaufschlag. Der ArenaGenerator haelt authored Spawn-zu-freundlicher-Basis-Routen auf hoechstens `COOP_DEFENSE_MAX_REQUIRED_TRACK_RUN_CELLS` aufeinanderfolgenden Gleiszellen und verwirft unguenstige Layoutversuche.
- Sichtlinie und Schusslinie sind getrennte Fragen: `CombatSystem.hasLineOfSight` prüft nur die statischen Hindernisse des `ArenaObstacleIndex` (Sehen, Spawn-Bewertung, Wegewahl), `CombatSystem.hasClearLineOfFire` zusätzlich die beweglichen physischen Blocker – zurzeit den Zug. Jede Entscheidung, die einen Schuss, Wurf oder Homing-Lock auslöst, fragt die Schusslinie; nur wer den beweglichen Blocker selbst angreift, bleibt bei der Sichtlinie, weil er sich sonst selbst verdeckt.
- Radiale Projektilpulse werden über `ProjectileProximityPulseConfig` und den gemeinsamen `HostUpdateCoordinator`-Resolver abgewickelt. Der Coop-Puls zielt auf feindliche Gegner, Felsen und den Zug; BFG-Spielerziele bleiben eine separate Erweiterung. Gegnerziele müssen über `CombatSystem.canDamageTarget()` gefiltert werden, damit verbündete oder übernommene Gegner nicht getroffen werden.
- Brand-Status (DoT), Stack-Buckets und Tick-Scheduling werden über die reine, zeit-parametrisierte `BurnStateMachine` (`src/combat/rules/BurnStateMachine.ts`) verwaltet. `CombatSystem` und Headless Balance Lab teilen diese Implementierung 1:1; die Schadensausführung verbleibt im autoritativen Schadens-Trichter des CombatSystems bzw. am Headless-Sink.
- Visuelle Effekte reagieren auf entschiedene Zustände und besitzen keinen eigenen Gameplay-Authority-Pfad.

## Strukturen, Schaden und Modifikatoren

Basen tragen Faction und Role aus der Map-Konfiguration. Dormante Strukturen verwenden BaseEntity.isInert() als gemeinsames Gate für Darstellung, Kollision, Licht, Türme, Spawns und Zielquellen. Räumliche Verbraucher müssen weiterhin alle Basen als Hindernisse kennen; nur Wirkungs- und Zielmengen filtern nach Faction oder Role. Zielmenge des Basis-Flowfields sind alle aktiven freundlichen Basen mit Role main sowie objective-gebundene Vorposten; dekorative Vorposten und Spawn-Points bleiben ausgenommen. Weil das Feld ein Mehrziel-Dijkstra ist, ergibt sich die Wahl der pfadnächsten Struktur ohne eigene Zielzuweisung je Gegner.

Strukturschaden läuft durch die zentralen CombatSystem-Callbacks. Direkttreffer, Hitscan, Nahkampf und Explosionen dürfen nicht je einen parallelen Basis-/Fels-Schadenspfad eröffnen. Die Herkunft eines Treffers wird über DamageApplicationOptions und sourceSlot geführt, nicht über weaponName oder Visuals. Besitzerwerte platzierter Konstrukte bleiben erhalten; ihre Schadensermittlung verwendet den gemeinsamen Resolver.

Türme und unbewaffnete Power-up-Podeste sind verschiedene Verantwortlichkeiten: TurretSystem besitzt Zielsuche und Turmfeuer, PowerUpSystem besitzt Pickup und Respawn von Podesten. Ein Turm verwendet seine eigene TURRET-Konfiguration und darf nicht versehentlich die Spielerwaffe mit demselben Namen erben.

Coop-Upgrades und Item-Affixe werden über dieselben additiven/percentualen Effekt-Buckets und resolveCoopDefenseStat() auf Host und Client aufgelöst. Der gespeicherte/committete Loadout ist die statische Projektion; Stapel, Timer und Laufzeitdebuffs gehören in CoopDefenseItemRuntimeSystem. Ein neuer Stat ist erst implementiert, wenn Descriptor, Resolver und beide Verbraucher existieren.

Konstruktionskapazität ist ein gemeinsamer Regelvertrag, keine Adrenalinressource. Die Kosten werden aus der Konstruktion selbst abgeleitet und über die gemeinsame reine Summenfunktion auf Host, HUD und Platzierungsvorschau berechnet; nur das persönliche Maximum darf durch aufgelöste Stats verändert werden.
