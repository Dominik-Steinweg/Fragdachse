# Lokale Persistenz

src/utils/localPreferences.ts ist die einzige Storage-Grenze. Einstellungen und Spielfortschritt verwenden getrennte versionierte Dokumente:

- fragdachse_settings_v1 für Audio und Grafikqualität;
- fragdachse_progress_v2 für Spielerprofil, Loadout und Coop-Fortschritt. Der Wechsel ist ein
  bewusster Alpha-Break; der vorherige Progress-Key wird nicht gelesen.

Der alte kombinierte Key wird nur für den einmaligen Alpha-Schnitt der Settings gelesen; Fortschritt wird daraus nicht still rekonstruiert.

## Migration und Sicherheit

Progress-Dokumente müssen exakt die aktuelle Schema-Version und die aktuellen Content-/ID-Verträge
erfüllen; es gibt keine Migration alter Progress-Schemata oder deutscher Vor-Translation-IDs.
Unbekannte, zukünftige oder strukturell ungültige Dokumente werden abgelehnt. Derselbe Decoder gilt
für localStorage und Dateiimport; vor einem Write muss das vollständige Dokument validiert sein.

Gespeichert werden stabile Eingaben und abgeleitete Progressionsdaten. Upgrade-Profile dürfen Defaults implizit aus den aktuellen Definitionen ableiten; JSON nicht unnötig mit Level-0-Knoten duplizieren. Laufzeit-Round-State gehört nicht in Storage.

## Cache und Import/Export

Coop-Defense-Klassen werden als explizite `unlockedClassIds` persistiert. Ein leerer Satz bedeutet, dass keine Spezialisierung verfügbar ist; Unlocks werden nach dem Sieg der authorierten Map mit dem klassenweisen `unlockAfterMapId`-Vertrag vergeben.

Die API hält den validierten Stand im Speicher. Getter lesen den Cache und geben für veränderbare Sammlungen Kopien aus; Setter aktualisieren den Cache synchron und behandeln Storage-/Quota-Fehler als nicht-fatal. Direkte externe Storage-Änderungen erfordern invalidateLocalStorageCache().

Der Client lädt seinen Round-Fallback beim Scene-Aufbau, Import und resetPerRound(), niemals in einem Frame-Getter. Export/Import verwendet das aktuelle, bewusst inkompatible Progress-Envelope ohne Audio-/Grafiksettings und ersetzt den vorhandenen Stand erst nach erfolgreicher Dekodierung.

Das Balance-Lab-Dokument ist ein eigener Storage-Vertrag mit eigener Schema-Version und einer
Obergrenze von 500 technischen Runden. Es speichert nur kompakte Zahlen, IDs, Build-Kontext und
optional zwei Bewertungen; Storage-/Quota-Fehler bleiben non-fatal. Die Balance-Ruleset-Version
ist davon getrennt und invalidiert alte Messungen global, während die Map-Balance-Signatur nur
betroffene Maps veraltet macht. Der Key `fragdachse_balance_lab_v1` ist weder Bestandteil des
Progress-Exports noch wird er durch `resetStoredCoopDefenseCharacter()` gelöscht.

Balance-Signaturen kanonisieren reine Übersetzungs-/Identifier-Migrationen und akzeptieren bekannte
Legacy-Hashes weiter; neue Balancewerte oder globale Ruleset-Änderungen bleiben dadurch weiterhin
invalidierungswirksam.
