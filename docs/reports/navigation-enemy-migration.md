# Gegnerprofile nach der Navigationsmigration

Quelle: `src/config/coopDefenseEnemies.json`, Waffenregistry und die bestehenden Fähigkeitssysteme.
Die Tabelle beschreibt die integrierte Migration, keine zweite Balancekonfiguration.

## Gemeinsame Regeln

- Körperprofile verwenden die normale konfigurierte Körpergröße. Dash-Verkleinerungen schaffen keine dauerhaften Routen.
- Spielerjäger wählen ein frei erreichbares zulässiges Spielerziel vor einem eingeschlossenen Spieler. Ein bekannter Spieler hinter einer Mauer bleibt ein gültiges Ziel.
- Ohne zulässiges Spielerziel: beschädigbare Basis bei geeigneter Waffe, danach eine tatsächlich beobachtete letzte Position, sonst warten. Erinnerung verfolgt keine aktualisierte Rauchposition und erlaubt keinen neuen Angriff. Bei Tod/Targetability-Verlust wird gewöhnliche Verfolgungserinnerung verworfen.
- Belagerer behalten die Basisabsicht. Fehlen aktive Basisziele, gilt die bestehende Ausrichtung auf Spielerziele. Nur ausdrücklich als `players` konfigurierte Waffen dürfen neben einer Belagerung Spieler bekämpfen.
- `all` berechtigt nicht zum Zielwechsel. Physisch bereits ausgelöste Schäden und ausdrücklich begonnene Salven, Dauerfeuerphasen oder Nahkampfausholbewegungen behalten ihre vorhandenen Regeln für gespeicherte Zielpunkte.
- Durchbruch setzt bestätigte Unerreichbarkeit voraus. Die folgende Bisswaffe wird nur benutzt, wenn Fraktion, Material, Waffen-Zielkategorien und Schadensmultiplikatoren den aktuellen Blocker zulassen. Basen sind letzter Ausweg; reine `rocks`-Waffen erlauben keinen Basisschaden.

## Migration je Art

| Art | Primärziel | Fallback | Erhaltene Nebenaktionen / exklusive Fähigkeiten | Durchbruchswaffe |
|---|---|---|---|---|
| `zombie-badger` | Basis | Spieler, falls keine aktive Basis | Angekündigter Nahkampf | `ZOMBIE_BADGER_BITE` |
| `demon-badger` | Basis | Spieler, falls keine aktive Basis | Angekündigter Nahkampf | `DEMON_BADGER_BITE` |
| `rabid-badger` | Spieler | Basis → letzte Position → warten | Angekündigter Nahkampf | `RABID_BADGER_BITE` |
| `grave-titan` | Basis | Spieler, falls keine aktive Basis | Explizite Anti-Spieler-Plasmasalve, Zugreaktion | `GRAVE_TITAN_BITE` |
| `spore-warden` | Basis | Spieler, falls keine aktive Basis | Explizite Anti-Spieler-Sporen | `SPORE_WARDEN_BITE` |
| `plague-medic` | Basis | Spieler, falls keine aktive Basis | Heilung bleibt Aura-Eigentum | `PLAGUE_MEDIC_BITE` |
| `void-stalker` | Spieler | Basis → letzte Position → warten | Translocator, Mini-Tesla | `VOID_STALKER_BITE` |
| `stink-broodmother` | Spieler | Basis → letzte Position → warten | Gestank und Todes-Spawns | `STINK_BROODMOTHER_BITE` |
| `alien-badger` | Spieler | Basis → letzte Position → warten | Eingraben, Fernkampfposition, Zugreaktion | `ALIEN_BADGER_BITE` |
| `thrower-badger` | Spieler | Basis → letzte Position → warten | Gebundener Spawn-Wurf | `THROWER_BADGER_BITE` |
| `inferno-colossus` | Spieler | Letzte Position → warten; keine Basiswaffe | Gebundenes Dauerfeuer, Raketensalve, Feuerfähigkeiten, Zugreaktion | `INFERNO_COLOSSUS_BITE`, nur Felsen |
| `pyro-badger` | Spieler | Basis → letzte Position → warten | Eingraben, Ausweichen, Fernkampfposition, Zugreaktion | `PYRO_BADGER_BITE` |
| `timebomb-badger` | Spieler und zulässige bewaffnete Konstrukte | Letzte Position → warten; keine reguläre Basiswaffe | Verbindliche Jagd, Zündung und Detonation bleiben exklusiv | `ZOMBIE_BADGER_BITE`, nur Felsen |
| `void-hunter` | Spieler | Basis → letzte Position → warten | Bossphasen, Eingraben, Ausweichen, Fernkampfposition | `VOID_HUNTER_BITE` |

## Verbündete und Prioritäten

Nekromantie besitzt weiterhin Wiederbelebung, Besitzer, Zielsuche, Follow-Plätze und den bestehenden Leash.
Ihre Ziele werden an dieselbe profilabhängige Navigation, Bewegungsprüfung und Durchbruchsplanung übergeben.
Der bestehende Leash-Teleport ist eine Fähigkeit; die neue allgemeine Recovery teleportiert nicht.

Bewegungssperren, Rückstoß/Zug und exklusive Fähigkeiten bleiben vor gewöhnlicher Fortbewegung.
Normales Verfolgen, Kampfpositionierung und Folgebewegung verwenden den gemeinsamen geometrisch geprüften
Bewegungsschritt. Die Physik bleibt die abschließende ausführende Instanz. Neue interne Navigationszustände
werden nicht über das Netzwerk repliziert.

## Regressionen

`EnemyIntentAndBreach`, `NavigationBodyGraph`, `NavigationCostsAndPositions` und `EnemySeparationGrid`
prüfen Zielkohärenz, Rauch-Erinnerung, freie Umwege, Körperfreiheit, Reservierungen, Fraktionswechsel und
geteilte mehrlagige Öffnungen. Bestehende Fähigkeiten-, Smoke-, Decoy-, Plague-, Timebomb-, Translocator-,
Nekromantie- und World-/Activity-/Netzwerk-Suiten bleiben die Prüfung der jeweiligen Besitzer.
