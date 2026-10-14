# language: de
# Separate file: longer flow, shared setup via Grundlage, two screenshots in one set.
@lang:de @schemes:light
Funktionalität: Person anlegen – Ablauf

  Grundlage:
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich bin in der Personenverwaltung

  Szenario: person-create-flow
    Wenn ich den Dialog zum Anlegen einer Person öffne
    Dann erstelle einen Screenshot "leer" vom Formular "Person anlegen"
    Wenn ich fülle das Feld "Vorname" mit "Max" aus
    Und ich wähle "Schuladministration" in der Auswahl "Rolle" aus
    Und markiere die Auswahl "Rolle" mit "1"
    Dann erstelle einen Screenshot "ausgefuellt" vom Formular "Person anlegen"
