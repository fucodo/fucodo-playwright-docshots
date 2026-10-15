# language: de
# Long page: links at the very bottom (like status.schullogin.de)
@lang:de @schemes:light @viewports:desktop,mobile
Funktionalität: Status-Seite – Feeds abonnieren

  Grundlage:
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/status"

  Szenario: status-feeds
    Wenn ich zum Link "alle Updates" scrolle
    Dann zeige mit einem Pfeil auf den Link "alle Updates" und mit "1" und dem Hinweis "RSS-Feed"
    Und zeige mit einem Pfeil auf den Link "alle Ereignisse" und mit "2" und dem Hinweis "Kalender (ICS)"
    Und erstelle einen Screenshot

  Szenario: status-feeds-auto
    # no scroll step: the screenshot scrolls the marked links into view by itself
    Dann markiere den Link "alle Updates" mit "1"
    Und markiere den Link "alle Ereignisse" mit "2"
    Und erstelle einen Screenshot

  Szenario: status-feeds-video
    Dann starte ein Video
    Und ich scrolle ans Seitenende
    Und zeige mit einem Pfeil auf den Link "alle Ereignisse" und mit "1" und dem Hinweis "Kalender abonnieren"
    Und ich scrolle nach oben
    Dann beende das Video
