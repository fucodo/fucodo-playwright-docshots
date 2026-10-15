# language: de
# Set the area once: targets are searched inside it, the screenshot crops to it
@lang:de @schemes:light @viewports:desktop,mobile
Funktionalität: In einem Bereich arbeiten

  Szenario: area-work-footer
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/status"
    Und ich arbeite in der Fußzeile
    # "Impressum" exists twice on the page – inside the footer it is unique
    Dann zeige mit einem Pfeil auf den Link "Impressum" mit "1"
    Und markiere den Link "alle Updates" mit "2" und Hinweis "RSS"
    Und erstelle einen Screenshot
    Und ich arbeite wieder auf der ganzen Seite
    Und ich scrolle an den Anfang der Seite
    Und die Seite ist ganz oben gescrollt
    Dann markiere den Link "Impressum" in der Kopfzeile mit "3"
    Und erstelle einen Screenshot "oben"

  Szenario: area-work-dialog
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich bin in der Personenverwaltung
    Wenn ich den Dialog zum Anlegen einer Person öffne
    Und ich arbeite im Dialog
    Und ich fülle das Feld "Vorname" mit "Max" aus
    Dann markiere den Button "Speichern" mit "1"
    Und erstelle einen Screenshot
