# Lokale Persistenz

`src/utils/localPreferences.ts` ist die einzige Storage-Grenze. Der Alpha-Schnitt verwendet zwei
getrennte Generation-Keys:

- `fragdachse_settings_v1` für Audio und Grafikqualität (`schemaVersion: 1`),
- `fragdachse_progress_v1` für Spielername, allgemeines Loadout und Coop-Fortschritt
  (aktuell `schemaVersion: 2`).

Der alte kombinierte Key `fragdachse_local_preferences` ist kein gültiger Spielstand mehr. Beim
ersten Start der neuen Generation werden daraus einmalig nur Audio und Grafik übernommen; der
Fortschritt startet kontrolliert frisch. Ein Charakter-Reset oder inkompatibler Fortschritt darf
die getrennten Einstellungen nie verändern.

## Schema und Migration

Migrationen beginnen bei Progress-Schema 1 und laufen in `migrateProgressDocument()` strikt und
sequenziell bis zur aktuellen Version. Unbekannte alte, zukünftige oder strukturell ungültige
Versionen werden nicht geraten. Derselbe Decoder gilt für `localStorage` und Dateiimporte; ein
ungültiger Import wird vor jedem Write abgelehnt.

Upgrade-Profile speichern nur Level, die vom aktuellen Klassenstandard abweichen. `unlocked` und
alle Default-/Level-0-Knoten werden beim Laden aus den aktuellen Upgrade-Definitionen abgeleitet.
Vor der Klassenfreischaltung wird nur `defaultProfile` gespeichert; `profilesByClass` und
klassenbezogene Loadouts erscheinen erst danach und nur bei tatsächlichem Inhalt.

## Cache-Vertrag

Der zusammengeführte, validierte Laufzeitstand wird nach dem ersten Read im Modul gehalten. Alle
Getter lesen nur diesen Cache und geben für veränderbare Sammlungen Kopien aus. Setter ersetzen
den Cache synchron und fangen Storage-/Quota-Fehler ab; Einstellungen und Fortschritt werden nur
in ihren jeweiligen Key geschrieben.

Direkte Änderungen außerhalb der API müssen `invalidateLocalStorageCache()` aufrufen. Der
`ClientUpdateCoordinator` hält zusätzlich seinen rundenbezogenen Profil-/Klassen-/Item-Fallback
und erneuert ihn bei Scene-Aufbau, Import und `resetPerRound()`. Seine Frame-Getter dürfen nie
selbst Persistenz laden.

## Dateiübertragung

Ein Klick auf den eigenen Spielernamen in der Lobby öffnet Export und Import. Das JSON-Envelope
trägt Format- und Exportversion sowie das vollständige Progress-Dokument, aber keine Audio- oder
Grafikeinstellungen. Import validiert Envelope, Schema und enthaltene Werte, führt dieselben
Migrationen wie ein lokaler Read aus und ersetzt den bestehenden Cache erst nach vollständig
erfolgreicher Dekodierung.
