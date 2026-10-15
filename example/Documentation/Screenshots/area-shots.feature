# language: de
# Screenshot of an area: named area, page region or CSS selector
@lang:de @schemes:light @viewports:desktop,mobile
Funktionalität: Screenshot eines Bereichs

  Grundlage:
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/status"

  Szenario: area-named
    # "Hauptmenü" is a named area in steps/index.ts
    Dann markiere den Link "Impressum" im Bereich "Hauptmenü" mit "1"
    Und erstelle einen Screenshot vom Bereich "Hauptmenü"

  Szenario: area-landmark
    Wenn ich ans Seitenende scrolle
    Dann erstelle einen Screenshot vom Bereich "Fußzeile"

  Szenario: area-selector
    Wenn ich ans Seitenende scrolle
    Dann markiere den Link "alle Ereignisse" mit "2"
    Und erstelle einen Screenshot vom Bereich "footer .feeds"
