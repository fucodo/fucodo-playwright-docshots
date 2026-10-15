# language: de
# Videos: start/stop, live markers, hiding markers, title card, element video.
@lang:de @schemes:light @viewports:desktop,mobile
Funktionalität: Person anlegen – Video

  Grundlage:
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich bin in der Personenverwaltung

  Szenario: person-create-video
    Dann starte ein Video
    Und zeige den Titel "Person anlegen" mit der Beschreibung "In drei Schritten"
    Und zeige mit einem Pfeil auf den Button "Neue Person" und mit "1" und dem Hinweis "Hier starten"
    Wenn ich auf den Button "Neue Person" klicke
    Und blende die Markierungen aus
    Und ich fülle das Feld "Vorname" mit "Max" aus
    Und markiere das Feld "Vorname" mit "2"
    Und ich gebe "Muster" in das Feld "Nachname" ein
    Und blende die Markierung "2" aus
    Und markiere den Button "Speichern" mit "3" und Hinweis "Zum Abschluss"
    Dann beende das Video

  Szenario: person-form-video
    Wenn ich den Dialog zum Anlegen einer Person öffne
    Dann starte ein Video vom Formular "Person anlegen"
    Und markiere das Feld "E-Mail" mit "1" und Hinweis "Pflichtfeld"
    Und ich gebe "max@schule.example" in das Feld "E-Mail" ein
    Und entferne die Markierung vom Feld "E-Mail"
    Und ich wähle "Schuladministration" in der Auswahl "Rolle" aus
    Und markiere die Auswahl "Rolle" mit "2"
    Dann erstelle einen Screenshot "mitten-im-video" vom Formular "Person anlegen"
    Und beende das Video
