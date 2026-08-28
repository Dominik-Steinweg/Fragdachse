# Local Persistence

## Geltungsbereich

Lokale Speicherung ist eine validierte Domänengrenze für Geräteeinstellungen, Profil-/Progress-Dokumente, Balance-Lab-Daten und den PersistentBase-Fortschritt. World- und Activity-Runtime gehören nicht direkt in LocalStorage und dürfen nicht aus rohen Speicherwerten rekonstruiert werden.

## Getrennte Dokumente

[src/utils/localPreferences.ts](../../src/utils/localPreferences.ts) trennt mindestens:

- Geräteeinstellungen wie Audio, Grafik und Locale;
- Progress mit Profil, Loadout, Coop-Defense-Daten und PersistentBase-State;
- optionale Debug- oder Balance-Lab-Dokumente.

Jedes Dokument besitzt seinen eigenen Speicher-Key und Schema-/Exportvertrag. Die aktuellen Schema- und Exportkonstanten werden ausschließlich in localPreferences.ts und den zugehörigen Types gepflegt; diese Seite wiederholt keine Drift-anfälligen Versionsnummern.

## Lesen, Validieren und Migrieren

Settings werden an der Speichergrenze sanitisiert. Ein ausdrücklich unterstützter älterer Settings-Stand darf dort in den aktuellen Dokumenttyp normalisiert werden. Progress- und Importdokumente werden gegen das aktuelle Format, alle erforderlichen Teilverträge und die Persistenz-Sanitizer geprüft; nicht erlaubte alte oder beschädigte Formate werden abgelehnt.

Import ist atomar: Erst nach vollständiger Validierung darf der bestehende Save ersetzt werden. Ein ungültiger Import verändert den gültigen Bestand nicht. Legacy-Migrationen gehören in den Decoder und werden nicht von Gameplay, UI oder einer World-Runtime nachgebaut.

## PersistentBase

PersistentBase ist Progress-Domain, nicht Activity-Runtime:

- [PersistentBaseRepository.ts](../../src/persistentBase/PersistentBaseRepository.ts) kapselt den lokalen Speicherzugriff.
- [PersistentBaseTypes.ts](../../src/persistentBase/PersistentBaseTypes.ts) sanitisiert den speicherbaren Blueprint und prüft nur storage-lokale Form.
- [PersistentBaseSession.ts](../../src/persistentBase/PersistentBaseSession.ts) führt eine missionslokale Working Copy mit Baseline, Commit oder Discard.
- [PersistentBaseRoomState.ts](../../src/persistentBase/PersistentBaseRoomState.ts) hält host-authoritativen Guest-Zustand im Raum, nicht im lokalen Save.
- [PersistentBaseRoundOutcome.ts](../../src/persistentBase/PersistentBaseRoundOutcome.ts) wendet Commit oder Rollback an.
- [PersistentBaseRestorePlanner.ts](../../src/persistentBase/PersistentBaseRestorePlanner.ts) prüft beim Wiederherstellen aktuelle Tools, Unlocks, World-Geometrie, Kollision und Kapazität deterministisch.

Persistiert werden nur permanente, gültige, host-owned Platzierungen. Runtime-IDs, HP, Cooldowns, temporäre Activity-Daten und Renderobjekte gehören nicht in den Blueprint. Der WorldRuntimeContext liefert die authored Site; die lokale Progress-Grenze liefert den veränderlichen Zustand.

## Cache, Fehler und Lebensdauer

Die Speicherfunktionen dürfen einen Cache verwenden, müssen ihn bei Schreib- oder Reset-Operationen gezielt invalidieren und dürfen fehlgeschlagene Persistenz nicht in einen unbrauchbaren In-Memory-Zustand überführen. Cache- und Save-Lifetime ist von ArenaScene-, World- und Activity-Lifetime getrennt.

Ein World- oder Scene-Teardown löscht keinen lokalen Progress automatisch. Ein Activity-Ende entscheidet über PersistentBase-Commit oder Rollback; der nächste World-Aufbau liest nur den validierten Baseline-Zustand.

## Erweiterungsregeln

- Neue persistente Daten erhalten einen eigenen validierten Dokument- oder Subdokumentvertrag.
- Lesen, Sanitizing, Migration und Schreiben bleiben an der Persistenzgrenze.
- Runtime-Systeme erhalten typisierte, validierte Werte und greifen nicht auf Speicher-Keys zu.
- Import/Export verwendet denselben fachlichen Validator wie lokales Lesen.
- Eine konkrete Version oder Legacy-Regel gehört nur hierher, wenn sie im aktuellen Decoder tatsächlich unterstützt und getestet ist.

## Maßgebliche Quellen und Tests

- [src/utils/localPreferences.ts](../../src/utils/localPreferences.ts)
- [src/persistentBase/PersistentBaseTypes.ts](../../src/persistentBase/PersistentBaseTypes.ts)
- [src/persistentBase/PersistentBaseSession.ts](../../src/persistentBase/PersistentBaseSession.ts)
- [tests/LocalPersistence.test.ts](../../tests/LocalPersistence.test.ts)
- [tests/PersistentBaseSession.test.ts](../../tests/PersistentBaseSession.test.ts)
- [tests/PersistentBaseRoomState.test.ts](../../tests/PersistentBaseRoomState.test.ts)
