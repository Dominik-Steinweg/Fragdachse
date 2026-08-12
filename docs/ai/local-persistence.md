# Lokale Persistenz

src/utils/localPreferences.ts ist die einzige Storage-Grenze. Einstellungen und Spielfortschritt verwenden getrennte versionierte Dokumente:

- fragdachse_settings_v1 für Audio und Grafikqualität;
- fragdachse_progress_v1 für Spielerprofil, Loadout und Coop-Fortschritt.

Der alte kombinierte Key wird nur für den einmaligen Alpha-Schnitt der Settings gelesen; Fortschritt wird daraus nicht still rekonstruiert.

## Migration und Sicherheit

Progress-Migrationen laufen in migrateProgressDocument() sequenziell bis zur aktuellen Schema-Version. Unbekannte, zukünftige oder strukturell ungültige Dokumente werden abgelehnt. Derselbe Decoder gilt für localStorage und Dateiimport; vor einem Write muss das vollständige Dokument validiert sein.

Gespeichert werden stabile Eingaben und abgeleitete Progressionsdaten. Upgrade-Profile dürfen Defaults implizit aus den aktuellen Definitionen ableiten; JSON nicht unnötig mit Level-0-Knoten duplizieren. Laufzeit-Round-State gehört nicht in Storage.

## Cache und Import/Export

Die API hält den validierten Stand im Speicher. Getter lesen den Cache und geben für veränderbare Sammlungen Kopien aus; Setter aktualisieren den Cache synchron und behandeln Storage-/Quota-Fehler als nicht-fatal. Direkte externe Storage-Änderungen erfordern invalidateLocalStorageCache().

Der Client lädt seinen Round-Fallback beim Scene-Aufbau, Import und resetPerRound(), niemals in einem Frame-Getter. Export/Import verwendet das versionierte Progress-Envelope ohne Audio-/Grafiksettings und ersetzt den vorhandenen Stand erst nach erfolgreicher Dekodierung.
