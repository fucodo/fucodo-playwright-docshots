# language: de
# The same link text twice on one page: narrowing down by region or by counting
@lang:de @schemes:light @viewports:desktop,mobile
Funktionalität: Status-Seite – zwei Links "Impressum"

  Grundlage:
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/status"

  Szenario: status-impressum-footer
    Wenn ich zum Link "Impressum" in der Fußzeile scrolle
    Dann zeige mit einem Pfeil auf den Link "Impressum" in der Fußzeile mit "7"
    Und erstelle einen Screenshot

  Szenario: status-impressum-header
    Dann markiere den ersten Link "Impressum" mit "1" und Hinweis "Oben im Menü"
    Und erstelle einen Screenshot

  Szenario: status-impressum-last
    Dann markiere den letzten Link "Impressum" mit "2"
    Und markiere den Link "alle Updates" in der Fußzeile mit "3"
    Und erstelle einen Screenshot
