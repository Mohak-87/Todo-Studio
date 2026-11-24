/* Todo Studio – Gesprächsmodus mit MO (wie ein Telefonat): reine Logik ohne Browser-Abhängigkeiten.
   Zustände, Sprechpause → automatisch senden, 3 Minuten Stille → Ende, Unterbrechen samt Echo-Filter,
   Kennzeichnung der Nachricht an die Zentrale und „erster Satz zuerst“ beim Vorlesen.
   Die Browser-Anbindung (Mikrofon, Lautsprecher) steckt in jarvis.js; hier ist alles mit Node testbar. */
const Gespraech = (() => {
  const ZUSTAENDE = ['aus', 'zuhoeren', 'denkt', 'spricht'];
  const ANZEIGE = { aus: '', zuhoeren: 'Ich höre zu …', denkt: 'Ich denke nach …', spricht: 'MO spricht – einfach reinreden zum Unterbrechen' };
  const PAUSE_MS = 1200;          // so lange still → Satz ist fertig und geht los
  const STILLE_MS = 3 * 60 * 1000; // so lange ohne Sprache → Gespräch endet
  const ECHO_NACHLAUF_MS = 1800;   // Spracherkennung liefert MOs eigene Worte oft noch kurz nach dem Ende
  // Diese Wörter unterbrechen MO auch allein („Stopp!“), sofern MO sie nicht gerade selbst sagt
  const STOPPWOERTER = ['stopp', 'stop', 'halt', 'warte', 'moment', 'ruhe', 'pause', 'nein', 'aufhoeren'];

  /** Klein, ohne Akzente/Umlaute und Satzzeichen – wie die Spracherkennung Wörter liefert. */
  function normalisieren(t) {
    return String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function woerter(t) { const n = normalisieren(t); return n ? n.split(' ') : []; }

  /**
   * Ist das Gehörte nur MOs eigene Stimme aus dem Lautsprecher? Ja, wenn (fast) alle Wörter
   * auch in dem stehen, was MO gerade sagt.
   */
  function istEcho(gehoert, gesprochen) {
    const w = woerter(gehoert);
    if (!w.length) return true;
    const mo = new Set(woerter(gesprochen));
    if (!mo.size) return false;
    const gleich = w.filter((x) => mo.has(x)).length;
    return gleich / w.length >= 0.6;
  }

  /**
   * Reicht das Gehörte, um MO beim Sprechen zu unterbrechen?
   * Mindestens zwei eigene (nicht von MO gesprochene) Wörter – oder ein Stoppwort.
   */
  function istUnterbrechung(gehoert, gesprochen) {
    const w = woerter(gehoert);
    if (!w.length || istEcho(gehoert, gesprochen)) return false;
    const mo = new Set(woerter(gesprochen));
    const neu = w.filter((x) => !mo.has(x));
    return neu.length >= 2 || neu.some((x) => STOPPWOERTER.includes(x));
  }

  /** Körper für POST /api/nachricht. Im Gespräch mit Kennzeichen, sonst unverändert wie bisher. */
  function nachrichtKoerper(text, gespraech) {
    return gespraech ? { text: String(text), gespraech: true } : { text: String(text) };
  }

  /**
   * Erster vollständiger Satz aus einem noch wachsenden Sprechtext (Live-Teilantwort) – oder ''.
   * Vollständig heißt: nach dem Satzzeichen geht es schon weiter. „am 3. Mai“ zählt nicht als Satzende.
   */
  function ersterSatz(teil) {
    const t = String(teil || '');
    const re = /[.!?…]+(?=\s+\S)/g;
    let m;
    while ((m = re.exec(t))) {
      const bis = m.index + m[0].length;
      if (/\d$/.test(t.slice(0, m.index)) && m[0] === '.') continue; // Ordnungszahl / Datum
      const satz = t.slice(0, bis).trim();
      if (satz.length >= 8) return satz;
    }
    return '';
  }

  /** Was nach dem schon vorab gesprochenen Anfang noch zu sagen ist. Passt der Anfang nicht, der ganze Text. */
  function restNach(gesamt, vorab) {
    const g = String(gesamt || ''), v = normalisieren(vorab).replace(/ /g, '');
    if (!v) return g.trim();
    if (!normalisieren(g).replace(/ /g, '').startsWith(v)) return g.trim();
    let gezaehlt = 0, i = 0;
    for (; i < g.length && gezaehlt < v.length; i++) gezaehlt += normalisieren(g[i]).replace(/ /g, '').length;
    return g.slice(i).replace(/^[\s.,;:!?…“”"'»«)-]+/, '').trim();
  }

  /**
   * Der Gesprächsablauf als Zustandsautomat. Zeit kommt immer von außen (ms), damit er ohne Browser testbar ist.
   * Die Oberfläche ruft gehoert() bei jedem Ergebnis der Spracherkennung und pruefen() regelmäßig auf
   * und führt die gelieferten Schritte aus: senden, unterbrechen, zeitablauf.
   */
  function erzeugen({ pauseMs = PAUSE_MS, stilleMs = STILLE_MS, echoNachlaufMs = ECHO_NACHLAUF_MS } = {}) {
    const g = {
      zustand: 'aus', fertig: '', zwischen: '', letztesErgebnis: 0, letzteAktivitaet: 0, gesprochen: '', echoBis: 0,
      get text() { return (g.fertig + ' ' + g.zwischen).replace(/\s+/g, ' ').trim(); },
      get aktiv() { return g.zustand !== 'aus'; },

      beginnen(jetzt) {
        Object.assign(g, { zustand: 'zuhoeren', fertig: '', zwischen: '', letztesErgebnis: 0, letzteAktivitaet: jetzt, gesprochen: '', echoBis: 0 });
      },
      beenden() { Object.assign(g, { zustand: 'aus', fertig: '', zwischen: '', gesprochen: '' }); },

      /**
       * Ein Ergebnis der Spracherkennung. final = endgültig erkannt (sonst Zwischenstand).
       * Liefert 'ignorieren' (Echo/leer), 'unterbrechen' (MO sofort verstummen lassen) oder 'puffern'.
       */
      gehoert(text, final, jetzt) {
        const t = String(text || '').trim();
        if (g.zustand === 'aus' || !t) return 'ignorieren';
        let art = 'puffern';
        if (g.zustand === 'spricht') {
          if (!istUnterbrechung(t, g.gesprochen)) return 'ignorieren';
          g.zustand = 'zuhoeren'; g.echoBis = 0; art = 'unterbrechen';
        } else if (jetzt < g.echoBis && !g.text && istEcho(t, g.gesprochen)) {
          return 'ignorieren'; // Nachhall von MOs letztem Satz
        }
        if (final) { g.fertig = (g.fertig + ' ' + t).trim(); g.zwischen = ''; } else g.zwischen = t;
        g.letztesErgebnis = jetzt; g.letzteAktivitaet = jetzt;
        return art;
      },

      /** Regelmäßig aufrufen. Liefert { art: 'senden', text } nach einer Sprechpause, { art: 'zeitablauf' } nach langer Stille, sonst null. */
      pruefen(jetzt) {
        if (g.zustand === 'aus' || g.zustand === 'spricht') return null;
        const text = g.text;
        if (text && jetzt - g.letztesErgebnis >= pauseMs) {
          g.fertig = ''; g.zwischen = ''; g.zustand = 'denkt'; g.letzteAktivitaet = jetzt;
          return { art: 'senden', text };
        }
        if (!text && g.zustand === 'zuhoeren' && jetzt - g.letzteAktivitaet >= stilleMs) {
          g.beenden();
          return { art: 'zeitablauf' };
        }
        return null;
      },

      /** Ein Sitzungsende der Spracherkennung: Zwischenstand gilt dann als gesagt. */
      erkennungEndet() { if (g.zwischen) { g.fertig = (g.fertig + ' ' + g.zwischen).trim(); g.zwischen = ''; } },

      /** MO fängt an zu sprechen (bei „erster Satz zuerst“ mehrfach – der Text wird angehängt). */
      spricht(text, jetzt) {
        if (g.zustand === 'aus') return;
        g.gesprochen = g.zustand === 'spricht' ? (g.gesprochen + ' ' + text).trim() : String(text || '');
        g.zustand = 'spricht'; g.letzteAktivitaet = jetzt;
      },

      /** MO ist fertig (oder wurde unterbrochen): wieder zuhören. Kein Text zum Vorlesen gilt ebenso. */
      gesprochenFertig(jetzt) {
        if (g.zustand === 'aus') return;
        if (g.zustand === 'spricht' || g.zustand === 'denkt') { g.zustand = 'zuhoeren'; }
        g.echoBis = jetzt + echoNachlaufMs; g.letzteAktivitaet = jetzt;
      },

      /** Antwort kam ohne Vorlesetext: direkt wieder zuhören. */
      denktFertig(jetzt) { if (g.zustand === 'denkt') { g.zustand = 'zuhoeren'; g.letzteAktivitaet = jetzt; } }
    };
    return g;
  }

  /** Verständlicher Hinweis, warum der Gesprächsmodus hier nicht geht – oder '' wenn alles bereit ist. */
  function voraussetzungen({ spracherkennung, sichererKontext, sprachausgabe }) {
    if (!sichererKontext) return 'Das Mikrofon ist nur über eine sichere Verbindung (https) erlaubt. Öffnen Sie das Studio über seine https-Adresse – über eine reine IP-Adresse mit http blockiert der Browser das Mikrofon.';
    if (!spracherkennung) return 'Dieser Browser kann keine Sprache erkennen. Das Gespräch funktioniert in Chrome am Laptop und auf dem Android-Handy.';
    if (!sprachausgabe) return 'Dieser Browser kann nicht vorlesen. Das Gespräch braucht eine Sprachausgabe – bitte Chrome verwenden.';
    return '';
  }

  /** Deutsche Meldungen zu Fehlern der Spracherkennung (SpeechRecognitionErrorEvent.error). endet = Gespräch beenden. */
  function fehlerText(code) {
    switch (code) {
      case 'not-allowed': case 'service-not-allowed':
        return { endet: true, text: 'Ich darf das Mikrofon nicht benutzen. Bitte erlauben Sie es im Browser (Schloss-Symbol neben der Adresse → Mikrofon → Zulassen) und starten Sie das Gespräch erneut.' };
      case 'audio-capture':
        return { endet: true, text: 'Es ist kein Mikrofon erreichbar. Bitte prüfen Sie, ob eines angeschlossen und in Windows bzw. Android freigegeben ist.' };
      case 'network':
        return { endet: true, text: 'Die Spracherkennung des Browsers braucht eine Internetverbindung. Bitte prüfen Sie die Verbindung.' };
      case 'language-not-supported':
        return { endet: true, text: 'Deutsch wird von der Spracherkennung dieses Browsers nicht unterstützt.' };
      default:
        return { endet: false, text: '' }; // no-speech, aborted: einfach weiter zuhören
    }
  }

  return { ZUSTAENDE, ANZEIGE, PAUSE_MS, STILLE_MS, STOPPWOERTER, normalisieren, istEcho, istUnterbrechung, nachrichtKoerper, ersterSatz, restNach, erzeugen, voraussetzungen, fehlerText };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Gespraech;
