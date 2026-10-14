# language: de
# Stress test for the annotation layout: corners, a tight cluster and fields close together.
@lang:de @schemes:light
Funktionalität: Markierungen – schwierige Anordnung

  Grundlage:
    Angenommen ich bin angemeldet als "schooladmin"
    Und ich öffne die Seite "/stress"

  Szenario: stress-corners
    Dann zeige mit einem Pfeil auf den Button "Ecke links" und mit "1" und dem Hinweis "Oben links"
    Und zeige mit einem Pfeil auf den Button "Ecke rechts" und mit "2" und dem Hinweis "Oben rechts"
    Und zeige mit einem Pfeil auf den Button "Unten links" und mit "3" und dem Hinweis "Unten links"
    Und zeige mit einem Pfeil auf den Button "Unten rechts" und mit "4" und dem Hinweis "Unten rechts"
    Und erstelle einen Screenshot

  Szenario: stress-cluster
    Dann zeige mit einem Pfeil auf den Button "Eins" und mit "1" und dem Hinweis "Erster Schritt"
    Und zeige mit einem Pfeil auf den Button "Zwei" und mit "2" und dem Hinweis "Zweiter Schritt"
    Und zeige mit einem Pfeil auf den Button "Drei" und mit "3" und dem Hinweis "Dritter Schritt"
    Und markiere das Feld "Suchbegriff" mit "4" und Hinweis "Pflichtfeld"
    Und markiere das Feld "Kategorie" mit "5"
    Und erstelle einen Screenshot
