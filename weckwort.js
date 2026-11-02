/* Todo Studio – Weckwort („Hey MO“, „Hey Jarvis“): tolerante Erkennung im Transkript der Spracherkennung.
   Die Listen unten sind die einzige Stelle, an der Weckwörter festgelegt werden. */
const Weckwort = (() => {
  // Vorsilben vor dem Namen („Hey“, „Hallo“, „Okay“ …) – in normalisierter Schreibweise (klein, ohne Akzente)
  const VORSILBEN = ['hey', 'hei', 'hej', 'he', 'hay', 'hi', 'ey', 'hallo', 'hallochen', 'okay', 'ok', 'oh'];

  // Je Weckwort: Namen mit Vorsilbe (überall im Satz), Namen ohne Vorsilbe (nur als erstes Wort)
  // und zusammengeschriebene Formen („Heimo“, „Heyjarvis“), die für sich allein reichen.
  const WECKWOERTER = [
    {
      wort: 'mo',
      namen: ['mo', 'moe', 'moh', 'mow', 'mou', 'moo', 'mohr', 'm o'],
      allein: ['mo', 'moe', 'moh'],
      zusammen: ['heimo', 'heymo', 'haimo', 'hymo', 'heimoh', 'eimo', 'hailmo', 'heymoe', 'heymoh'],
    },
    {
      wort: 'jarvis',
      namen: ['jarvis', 'jarwis', 'javis', 'jervis', 'dschawis', 'dscharvis', 'tscharvis', 'charvis', 'jarvi'],
      allein: ['jarvis', 'jarwis', 'javis', 'jervis', 'dschawis', 'dscharvis', 'tscharvis', 'charvis', 'jarvi'],
      zusammen: ['heyjarvis', 'heijarvis', 'hejarvis'],
    },
  ];

  /** Kleinbuchstaben, Akzente/Umlaute vereinheitlicht, Satzzeichen weg, Leerzeichen zusammengefasst. */
  function normalisieren(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Wörter des Originaltexts mit Position, damit der Rest des Satzes unverändert (mit Umlauten) weitergeht. */
  function woerter(t) {
    const liste = [];
    const re = /[\p{L}\p{N}]+/gu;
    let m;
    while ((m = re.exec(t))) liste.push({ n: normalisieren(m[0]), ende: m.index + m[0].length });
    return liste.filter((w) => w.n);
  }

  /** Passt ein (ggf. mehrteiliger) Name an Stelle i? Liefert die Anzahl Wörter oder 0. */
  function nameAn(w, i, namen) {
    for (const name of namen) {
      const teile = name.split(' ');
      if (teile.every((teil, k) => w[i + k] && w[i + k].n === teil)) return teile.length;
    }
    return 0;
  }

  /**
   * Sucht ein Weckwort im Satz. Treffer: { wort: 'mo'|'jarvis', rest: 'Anweisung danach' }, sonst null.
   * Mit Vorsilbe („Hey Mo“) überall im Satz; der Name allein („Mo, …“) nur als erstes Wort.
   */
  function erkennen(text) {
    const t = String(text || '');
    const w = woerter(t);
    if (!w.length) return null;
    const treffer = (ww, letztes) => ({ wort: ww.wort, rest: t.slice(w[letztes].ende).replace(/^[\s,.;:!?…–—-]+/, '').trim() });
    for (let i = 0; i < w.length; i++) {
      for (const ww of WECKWOERTER) {
        if (ww.zusammen.includes(w[i].n)) return treffer(ww, i);
        if (VORSILBEN.includes(w[i].n)) {
          const n = nameAn(w, i + 1, ww.namen);
          if (n) return treffer(ww, i + n);
        }
        if (i === 0) {
          const n = nameAn(w, 0, ww.allein);
          if (n) return treffer(ww, n - 1);
        }
      }
    }
    return null;
  }

  /** Prüft alle Alternativen eines Ergebnisses (SpeechRecognitionResult) und liefert den ersten Treffer. */
  function inAlternativen(ergebnis) {
    for (let k = 0; k < ergebnis.length; k++) {
      const r = erkennen(ergebnis[k].transcript);
      if (r) return r;
    }
    return null;
  }

  return { VORSILBEN, WECKWOERTER, normalisieren, erkennen, inAlternativen };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Weckwort;
