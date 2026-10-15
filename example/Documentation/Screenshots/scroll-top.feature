# language: de
# Scrolling back to the top – window scrolling and an inner scroll area (app shell), both with CSS smooth scrolling
@lang:de @schemes:light @viewports:desktop,mobile
Funktionalität: Nach oben scrollen

  Szenario: scroll-top-window
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/status"
    Und ich scrolle ans Seitenende
    Und die Seite ist ganz unten gescrollt
    Und ich scrolle an den Anfang der Seite
    Und die Seite ist ganz oben gescrollt
    Dann erstelle einen Screenshot

  Szenario: scroll-top-app
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/status-app"
    Und ich scrolle ans Seitenende
    Und die Seite ist ganz unten gescrollt
    Und ich scrolle an den Anfang der Seite
    Und die Seite ist ganz oben gescrollt
    Dann erstelle einen Screenshot

  Szenario: scroll-top-video
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/status"
    Dann starte ein Video
    Und ich scrolle ans Seitenende
    Und die Seite ist ganz unten gescrollt
    Und ich scrolle an den Anfang der Seite
    Und die Seite ist ganz oben gescrollt
    Dann erstelle einen Screenshot "oben"
    Und beende das Video
