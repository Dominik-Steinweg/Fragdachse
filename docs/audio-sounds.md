# Sound-Trigger und spätere Audio-Produktion

Alle Sounds laufen über `GameAudioSystem` und den zentralen [Audiokatalog](../src/audio/AudioCatalog.ts). Es wurden keine Audiodateien oder Platzhalter erzeugt. Neue IDs beginnen mit Lautstärkefaktor `0.5`; bestehende Faktoren bleiben erhalten. Master-, Effektlautstärke und Stummschaltung wirken wie bisher.

## IDs und Dateien

Für **jede** ID in der Tabelle lautet der eigene Zielpfad **`public/assets/sounds/<ID>.ogg`**, beispielsweise `public/assets/sounds/sfx_enemy_death.ogg`.

| Ereignis | Sound-ID | Wiedergabe / Bestätigung |
| --- | --- | --- |
| Gegnertod | `sfx_enemy_death` | Räumlich, bestätigter feindlicher Tod, auch ohne Standard-Todesanimation |
| Spielertod | `sfx_player_death` | Räumlich, genau einmal pro Spielerleben; sofort vor Lifecycle-Callbacks an Host und Clients |
| Menü-Hover | `sfx_menu_hover` | Lokal, aktives Bedienelement betreten |
| Menü-Aktivierung | `sfx_menu_activate` | Lokal, akzeptierte Aktion am bisherigen Pointer-Ereignis |
| Rundensieg | `sfx_round_victory` | Lokal, endgültiger persönlicher Sieg |
| Rundenniederlage | `sfx_round_defeat` | Lokal, endgültige persönliche Niederlage |
| Adrenalin-Essenz | `sfx_pickup_adrenaline_essence` | Lokal beim Sammler, gültiger Transferbeleg mit positiver Gutschrift |
| HP (`HEALTH_PACK`) | `sfx_pickup_hp` | Lokal beim Sammler, erfolgreiche Aufnahme |
| Rüstung (`ARMOR`) | `sfx_pickup_armor` | Lokal beim Sammler, erfolgreiche Aufnahme |
| Rage (`RAGE`) | `sfx_pickup_rage` | Lokal beim Sammler, erfolgreiche Aufnahme |
| Adrenalinspritze (`ADRENALINE`) | `sfx_pickup_adrenaline` | Lokal beim Sammler, erfolgreiche Aufnahme |
| Doppelter Schaden (`DOUBLE_DAMAGE`) | `sfx_pickup_double_damage` | Lokal beim Sammler, erfolgreiche Aufnahme |
| Nuke (`NUKE`) | `sfx_pickup_nuke` | Lokal beim Sammler, erfolgreiche Aufnahme |
| Heilige Handgranate (`HOLY_HAND_GRENADE`) | `sfx_pickup_holy_hand_grenade` | Lokal beim Sammler, erfolgreiche Aufnahme |
| BFG (`BFG`) | `sfx_pickup_bfg` | Lokal beim Sammler, erfolgreiche Aufnahme |
| Wellenbeginn | `sfx_wave_start` | Missionsmeldung beim ersten erfolgreichen Encounter-Spawn |
| Bossankündigung | `sfx_boss_announce` | Missionsmeldung nach erfolgreichem Boss-Spawn |
| Missionsziel erfüllt | `sfx_objective_complete` | Missionsmeldung beim bestätigten Objective-Abschluss |
| Kontrollpunkt aktiviert | `sfx_checkpoint_activate` | Missionsmeldung bei erstmaliger Aktivierung |
| Ultimate bereit | `sfx_ultimate_ready` | Lokal, bestätigte Ressourcen überschreiten Einsatzschwelle |
| Levelaufstieg | `sfx_level_up` | Lokal, ein Ton je XP-Verbuchung mit Levelsteigerung, auch beim Zerlegen |
| Upgrade gekauft | `sfx_upgrade_purchased` | Lokal nach erfolgreichem Kauf; ersetzt Menüklick |
| Belohnungsitem ausgewählt | `sfx_item_selected` | Lokal nach erfolgreicher Entscheidung für eines der drei Angebote; ersetzt Menüklick |
| Tesla aktiviert | `sfx_tesla_activate` | Räumlich über vorhandenen Renderer; replizierte Aktivierungssequenz |
| Felsen platziert | `sfx_place_rock` | Räumlich über vorhandene Platzierungspfade; bestätigte neue Platzierung |

Die zentrale Pickup-Zuordnung steht in [GameplayAudioFeedback.ts](../src/audio/GameplayAudioFeedback.ts). Reine HUD-Buffs bekommen keinen Pickup-Ton. Direkte Aufnahme und Netzwerk-RPC verwenden denselben erfolgreichen `PowerUpSystem.onPickupCollected`-Abschluss mit Objekt-ID, Definition-ID und Position.

## Späterer Workflow: ausschließlich Audio Studio

1. Eigenes OGG am oben genannten Zielpfad ablegen.
2. In `tools/audio-studio` den Bestand mit `uv run --inexact audio-studio sync` synchronisieren.
3. Im Studio beim Sound **Arbeitskopie importieren** verwenden.
4. Die Arbeitskopie mit dem vorbereiteten Profil verarbeiten, anhören und Schnitt/Pegel bei Bedarf anpassen.
5. Das konkrete verarbeitete OGG über **Übernehmen** veröffentlichen. Die bestehende Übernahme aktualisiert die Datei **und automatisch `SHIPPED_AUDIO_FILES`** im Spielkatalog.
6. Spiel neu laden beziehungsweise `npm run build` ausführen.

Die neuen [Studio-Rezepte](../tools/audio-studio/catalog/sounds.json) enthalten Soundabsicht, englischen Prompt, `oneshot`, Medium, zwei Sekunden, vier Kandidaten und das vorhandene Verarbeitungsprofil `gentle`. Das sind Produktionsvorgaben; Generierung ist für eigene Dateien nicht nötig. Bereits vorhandene Autorenfelder wurden bewahrt. Details zur Studio-Bedienung stehen im [Studio-README](../tools/audio-studio/README.md).

**Nur eine Datei abzulegen erteilt noch keine Ladefreigabe.** Solange die Studio-Übernahme fehlt, überspringt der Loader geplante Sounds vollständig. Es gibt keine Dateianfragen, Warnschleifen oder Ersatzsounds. Nicht geladene, stummgeschaltete oder bei gesperrtem Audio eintreffende One-Shots werden verworfen und später nicht nachgespielt. Musik und ihre verzögerte Lade-/Nachladelogik bleiben unverändert.

## Ereignisgrenzen

Der zuverlässige Bridge-Kanal überträgt Identität, monotone Sequenz, World-/gegebenenfalls Activity-Revision, Sound-ID, Empfänger und optionale Weltposition. Host und Clients verwenden denselben deduplizierten Empfangspfad. Häufige Ereignisse werden im Simulationsschritt gesammelt; Spielertod und abschließende Missionsmeldungen werden vor möglichen Lifecycle-Wechseln übertragen. Hover, Gegnerkills, einzelne Pickup-Arten und Essenz haben getrennte kurze Begrenzungen. Unterschiedliche Spielertode unterdrücken sich nicht.

Despawn, Cleanup, initiale Snapshots, bloße Visual-Neuerzeugung, wiederholte Synchronisierung und abgelehnte Aktionen bleiben stumm. Tesla merkt sich Aktivierungssequenzen über Visual-Neuerzeugung hinweg; Felsen tragen ihre Platzierungsbestätigung nur im laufenden World-Zustand. Ultimate-Baselines, Loadout-Wechsel und vorhergesagte Ressourcenausgaben erzeugen keine Bereitschaftsmeldung. Ergebnis-Replay, Unentschieden und technische Abbrüche spielen keinen Ergebnis-Ton.

Browser- und Hörabnahme bleiben bis zur Audioerstellung und ausdrücklichen Browserfreigabe offen: Lautheit, räumlicher Eindruck, Überlagerung bei Massenkills/Pickups und Host-/Client-Hörvergleich.
