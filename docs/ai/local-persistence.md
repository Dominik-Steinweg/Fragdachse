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

PersistentBase ist persönlicher Progress, nicht Activity-Runtime:

- [PersistentBaseTypes.ts](../../src/persistentBase/PersistentBaseTypes.ts) sanitisiert den persönlichen Beitrag und prüft nur storage- und wire-lokale Form.
- [PersistentBaseContributionStore.ts](../../src/persistentBase/PersistentBaseContributionStore.ts) führt den host-seitigen Runtime-Arbeitsstand aller Beiträge mit Baseline, Commit oder Rollback.
- [PersistentBaseRoundOutcome.ts](../../src/persistentBase/PersistentBaseRoundOutcome.ts) wendet Commit oder Rollback auf alle Beiträge gemeinsam an.

Persistiert wird der persönliche Beitrag eines Spielers, nicht der Zustand einer Basis: Jeder Spieler speichert ausschließlich seinen eigenen Beitrag auf seinem eigenen Gerät, unter einer dauerhaften Besitzeridentität, die niemals aus Peer-ID, Room-ID oder Session abgeleitet wird. `ownerId` identifiziert fachlichen Besitz über Sessions hinweg, beweist aber nicht, dass eine eingehende Mutation autorisiert ist. Der Host validiert Netzwerkaktionen und Änderungen unabhängig; eine übereinstimmende `ownerId` allein erteilt kein Änderungsrecht.

Ein Client darf nur einen host-bestätigten Beitrag speichern. Ohne diese Regel könnte ein manipulierter Client seine eigene Revision erhöhen und ungeprüftes Bauwerk dauerhaft in den autoritativen Fluss drücken. Die Revision des Beitrags ist ausdrücklich weder eine World- noch eine Activity-Revision; ein veralteter Stand wird abgelehnt, statt einen neueren zurückzudrehen.

Runtime-IDs, HP, Cooldowns, temporäre Activity-Daten und Renderobjekte gehören nicht in den Blueprint. Der WorldRuntimeContext liefert Site, Kern und World-Geometrie; die lokale Progress-Grenze liefert den dauerhaften Beitrag, und die Runtime/Working Copy den aktuellen bearbeitbaren Zustand.

## Cache, Fehler und Lebensdauer

Die Speicherfunktionen dürfen einen Cache verwenden, müssen ihn bei Schreib- oder Reset-Operationen gezielt invalidieren und dürfen fehlgeschlagene Persistenz nicht in einen unbrauchbaren In-Memory-Zustand überführen. Cache- und Save-Lifetime ist von ArenaScene-, World- und Activity-Lifetime getrennt.

Ein World- oder Scene-Teardown löscht keinen lokalen Progress automatisch und ist keine Persistenz- oder Besitzgrenze. Eine neue Working Copy startet vom zuletzt bestätigten beziehungsweise committed Beitrag. `committed` bezeichnet den zuletzt akzeptierten Stand, `baseline` den Ausgangsstand der aktuellen Working Copy und `working` den aktuellen bearbeitbaren Zustand. Ein Activity-/Round-Ausgang kann die Working Copy committen oder verwerfen; dauerhaft gespeichert bleibt ausschließlich der persönliche Beitrag seines Besitzers.

## Erweiterungsregeln

- Neue persistente Daten erhalten einen eigenen validierten Dokument- oder Subdokumentvertrag.
- Lesen, Sanitizing, Migration und Schreiben bleiben an der Persistenzgrenze.
- Runtime-Systeme erhalten typisierte, validierte Werte und greifen nicht auf Speicher-Keys zu.
- Import/Export verwendet denselben fachlichen Validator wie lokales Lesen.
- Eine konkrete Version oder Legacy-Regel gehört nur hierher, wenn sie im aktuellen Decoder tatsächlich unterstützt und getestet ist.

## Maßgebliche Quellen und Tests

- [src/utils/localPreferences.ts](../../src/utils/localPreferences.ts)
- [src/persistentBase/PersistentBaseTypes.ts](../../src/persistentBase/PersistentBaseTypes.ts)
- [src/persistentBase/PersistentBaseContributionStore.ts](../../src/persistentBase/PersistentBaseContributionStore.ts)
- [tests/LocalPersistence.test.ts](../../tests/LocalPersistence.test.ts)
- [tests/PersistentBaseContributionStore.test.ts](../../tests/PersistentBaseContributionStore.test.ts)
- [tests/PersistentBaseContributionSync.test.ts](../../tests/PersistentBaseContributionSync.test.ts)
