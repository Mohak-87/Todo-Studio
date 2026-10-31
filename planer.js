/**
 * To-Do-Studio – Planer & Sprachverständnis
 *
 * Reine Rechenlogik ohne Google-Dienste. Diese Datei läuft unverändert auch
 * im Browser (Demo-Modus): web/planer.js ist eine 1:1-Kopie davon.
 * Wenn du hier etwas änderst, kopiere die Datei danach nach web/planer.js.
 */

const PRIO_PUNKTE = { 1: 30, 2: 15, 3: 5 };
const WOCHENTAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const WOCHENTAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONATE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const ZAHLWORTE = {
  ein: 1, eins: 1, eine: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7,
  acht: 8, neun: 9, zehn: 10, elf: 11, 'zwölf': 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15,
  sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, 'dreißig': 30, 'fünfundvierzig': 45, neunzig: 90
};
const ZAHL_MUSTER = '(\\d{1,3}|' + Object.keys(ZAHLWORTE).sort(function (a, b) { return b.length - a.length; }).join('|') + ')';

// ---------- kleine Helfer ----------

function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function zeitZuMin_(hhmm) { const t = String(hhmm).split(':'); return Number(t[0]) * 60 + Number(t[1] || 0); }
function minZuZeit_(min) { min = Math.max(0, Math.min(min, 24 * 60 - 1)); return pad2_(Math.floor(min / 60)) + ':' + pad2_(min % 60); }
function dauerText_(min) {
  min = Math.round(min);
  if (min < 60) return min + ' Min.';
  const h = Math.floor(min / 60), m = min % 60;
  return m ? h + ' Std. ' + m + ' Min.' : h + ' Std.';
}
function datumPlusTage_(iso, tage) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}
function wochentag_(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
function tageZwischen_(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
function datumKurz_(iso, heute) {
  if (!iso) return '';
  if (heute) {
    const diff = tageZwischen_(heute, iso);
    if (diff === 0) return 'heute';
    if (diff === 1) return 'morgen';
    if (diff === 2) return 'übermorgen';
    if (diff === -1) return 'gestern';
  }
  return WOCHENTAGE_KURZ[wochentag_(iso)] + ', ' + Number(iso.slice(8, 10)) + '.' + Number(iso.slice(5, 7)) + '.';
}
function zahl_(s) {
  if (s == null) return null;
  s = String(s).toLowerCase();
  if (/^\d/.test(s)) return Number(s.replace(',', '.'));
  return ZAHLWORTE.hasOwnProperty(s) ? ZAHLWORTE[s] : null;
}
function anzahl_(n, eins, mehr) { return n === 1 ? eins : (n === 0 ? 'keine' : n) + ' ' + mehr; }

// ---------- Tagesplanung (regelbasiert) ----------

/**
 * Erstellt einen Tagesvorschlag.
 * eingabe: { datum, istHeute, jetztMin, arbeitsbeginn, arbeitsende,
 *            termine: [{titel, startMin, endeMin, ganztags}],
 *            aufgaben: [{id, titel, faellig, prio, dauer}],
 *            wichtigeMails, erledigtHeute, ideenAnzahl }
 */
function planErstellen_(e) {
  const beginn = zeitZuMin_(e.arbeitsbeginn || '08:00');
  const ende = zeitZuMin_(e.arbeitsende || '18:00');
  const jetzt = e.istHeute ? e.jetztMin : beginn;
  const ab = Math.max(beginn, Math.ceil(jetzt / 5) * 5);
  const heute = e.datum;
  const hinweise = [];

  const alleTermine = (e.termine || []).filter(function (t) { return !t.ganztags && t.startMin != null; })
    .sort(function (a, b) { return a.startMin - b.startMin; });
  const ganztags = (e.termine || []).filter(function (t) { return t.ganztags; }).map(function (t) { return t.titel; });

  // 1. Überschneidungen
  for (let i = 0; i < alleTermine.length; i++) {
    for (let j = i + 1; j < alleTermine.length; j++) {
      const a = alleTermine[i], b = alleTermine[j];
      if (b.startMin >= a.endeMin) break;
      hinweise.push({
        art: 'konflikt',
        text: '„' + a.titel + '“ und „' + b.titel + '“ überschneiden sich (' + minZuZeit_(b.startMin) + '–' +
          minZuZeit_(Math.min(a.endeMin, b.endeMin)) + '). Magst du einen davon verschieben?'
      });
    }
  }

  // 2. Belegte Zeit im Arbeitsfenster (exakt zusammengeführt)
  const belegt = [];
  alleTermine.forEach(function (t) {
    const s = Math.max(t.startMin, beginn), en = Math.min(t.endeMin, ende);
    if (en <= s) return;
    const letzt = belegt[belegt.length - 1];
    if (letzt && s <= letzt.ende) letzt.ende = Math.max(letzt.ende, en);
    else belegt.push({ start: s, ende: en });
  });
  const terminMin = belegt.reduce(function (s, b) { return s + b.ende - b.start; }, 0);

  // 3. Termin-Marathon (Pausen unter 15 Min. zählen nicht als Pause)
  const marathon = [];
  belegt.forEach(function (b) {
    const letzt = marathon[marathon.length - 1];
    if (letzt && b.start - letzt.ende < 15) letzt.ende = b.ende;
    else marathon.push({ start: b.start, ende: b.ende });
  });
  marathon.forEach(function (m) {
    if (m.ende - m.start > 180) {
      hinweise.push({
        art: 'tipp',
        text: 'Von ' + minZuZeit_(m.start) + ' bis ' + minZuZeit_(m.ende) + ' hast du Termine fast ohne Pause. ' +
          'Plane danach bewusst 15 Minuten zum Durchatmen ein.'
      });
    }
  });

  // 4. Freie Lücken ab jetzt
  let luecken = [];
  let cursor = ab;
  belegt.forEach(function (b) {
    if (b.start > cursor) luecken.push({ start: cursor, ende: Math.min(b.start, ende) });
    cursor = Math.max(cursor, b.ende);
  });
  if (cursor < ende) luecken.push({ start: cursor, ende: ende });
  luecken = luecken.filter(function (l) { return l.ende - l.start >= 15; });
  const freiMin = luecken.reduce(function (s, l) { return s + l.ende - l.start; }, 0);

  // 5. Aufgaben bewerten
  const bewertet = (e.aufgaben || []).filter(function (a) { return !a.erledigt; }).map(function (a) {
    const prio = Number(a.prio) || 2, dauer = Number(a.dauer) || 30;
    const ueberfaellig = a.faellig && a.faellig < heute ? tageZwischen_(a.faellig, heute) : 0;
    const heuteFaellig = a.faellig === heute;
    const muss = ueberfaellig > 0 || heuteFaellig || (!a.faellig && prio === 1);
    const kann = !muss && prio <= 2 && (!a.faellig || a.faellig <= datumPlusTage_(heute, 2));
    let punkte = PRIO_PUNKTE[prio] || 15;
    if (ueberfaellig) punkte += 25 + Math.min(ueberfaellig, 5) * 2;
    if (heuteFaellig) punkte += 15;
    if (dauer <= 15) punkte += 3;
    return { art: 'aufgabe', id: a.id, titel: a.titel, prio: prio, dauer: dauer, ueberfaellig: ueberfaellig, muss: muss, kann: kann, punkte: punkte };
  });
  if (e.wichtigeMails > 0) {
    bewertet.push({
      art: 'mails', id: null, titel: 'Wichtige Mails beantworten (' + e.wichtigeMails + ')', prio: 2,
      dauer: Math.min(60, Math.max(15, e.wichtigeMails * 5)), ueberfaellig: 0, muss: true, kann: false, punkte: 22
    });
  }
  const nachPunkten = function (a, b) { return b.punkte - a.punkte; };
  const muss = bewertet.filter(function (a) { return a.muss; }).sort(nachPunkten);
  const kann = bewertet.filter(function (a) { return a.kann; }).sort(nachPunkten);
  const mussMin = muss.reduce(function (s, a) { return s + a.dauer; }, 0);

  // 6. Einplanen: Wichtiges/Langes möglichst früh, Kleines in passende Lücken
  const slots = luecken.map(function (l) { return { start: l.start, ende: l.ende }; });
  const eingeplant = [], nichtEingeplant = [];
  muss.concat(kann).forEach(function (a) {
    const passend = slots.filter(function (s) { return s.ende - s.start >= a.dauer; });
    if (!passend.length) { if (a.muss) nichtEingeplant.push(a); return; }
    let ziel = passend[0];
    if (!(a.dauer >= 45 || (a.muss && a.punkte >= 40))) {
      ziel = passend.reduce(function (best, s) { return (s.ende - s.start) < (best.ende - best.start) ? s : best; });
    }
    eingeplant.push({
      art: a.art, id: a.id, titel: a.titel, startMin: ziel.start, endeMin: ziel.start + a.dauer,
      prio: a.prio, muss: a.muss, vorschlag: true
    });
    ziel.start += a.dauer + 5;
  });

  // 7. Überlastung (bzw. Feierabend)
  const feierabend = !!e.istHeute && ende - jetzt < 20; // weniger als 20 Min. übrig = Feierabend
  const offenHeute = muss.filter(function (a) { return a.art === 'aufgabe'; });
  if (feierabend && offenHeute.length) {
    hinweise.unshift({
      art: 'tipp',
      text: 'Dein Arbeitstag ist vorbei. ' + anzahl_(offenHeute.length, 'Eine fällige Aufgabe ist', 'fällige Aufgaben sind') +
        ' noch offen – schieb sie auf morgen, dann startest du sortiert und mit freiem Kopf.',
      schieben: offenHeute.filter(function (a) { return !(a.prio === 1 && a.ueberfaellig); }).map(function (a) { return a.id; })
    });
  } else if (!feierabend && mussMin > freiMin && muss.length) {
    let zuViel = mussMin - freiMin;
    const schieben = [];
    muss.slice().sort(function (a, b) { return a.punkte - b.punkte; }).forEach(function (a) {
      if (zuViel > 0 && a.art === 'aufgabe' && !(a.prio === 1 && a.ueberfaellig)) { schieben.push(a); zuViel -= a.dauer; }
    });
    hinweise.unshift({
      art: 'warnung',
      text: 'Heute ist mehr geplant, als reinpasst: ca. ' + dauerText_(mussMin) + ' Aufgaben bei ' + dauerText_(freiMin) +
        ' freier Zeit.' + (schieben.length
        ? ' Mein Vorschlag: Schieb ' + schieben.map(function (a) { return '„' + a.titel + '“'; }).join(', ') + ' auf morgen – dann bleibt dein Tag machbar.'
        : ' Überleg, was du heute bewusst weglässt.'),
      schieben: schieben.map(function (a) { return a.id; })
    });
  } else if (!feierabend && freiMin === 0 && alleTermine.length && e.istHeute) {
    hinweise.push({ art: 'tipp', text: 'Dein Kalender ist heute dicht. Nimm dir höchstens eine Mini-Aufgabe vor – das reicht völlig.' });
  }

  const ueberfaelligAnz = bewertet.filter(function (a) { return a.ueberfaellig; }).length;
  if (ueberfaelligAnz >= 3) {
    hinweise.push({
      art: 'tipp',
      text: ueberfaelligAnz + ' Aufgaben sind überfällig. Entscheide bei jeder kurz: heute erledigen, neu terminieren oder streichen – das schafft sofort Luft im Kopf.'
    });
  }
  const fensterMin = Math.max(1, ende - beginn);
  const prozent = Math.min(150, Math.round((terminMin + mussMin) / fensterMin * 100));
  if (prozent < 50 && kann.length === 0 && e.ideenAnzahl > 0 && (!e.istHeute || jetzt < ende - 60)) {
    hinweise.push({ art: 'tipp', text: 'Du hast heute Luft. Perfekt, um eine Idee aus deinem Speicher anzugehen.' });
  }
  if (e.erledigtHeute >= 3) {
    hinweise.push({ art: 'lob', text: 'Schon ' + e.erledigtHeute + ' Dinge erledigt heute. Das ist echter Fortschritt.' });
  }

  // 8. Reihenfolge
  const reihenfolge = alleTermine.map(function (t) {
    return {
      art: 'termin', id: t.id || null, titel: t.titel, startMin: t.startMin, endeMin: t.endeMin, ort: t.ort || '',
      vorbei: !!e.istHeute && t.endeMin <= e.jetztMin
    };
  }).concat(eingeplant).sort(function (a, b) { return a.startMin - b.startMin || (a.art === 'termin' ? -1 : 1); });
  const naechster = reihenfolge.filter(function (r) { return !r.vorbei && r.endeMin > (e.istHeute ? e.jetztMin : 0); })[0] || null;

  // 9. Texte
  const top = muss.filter(function (a) { return a.art === 'aufgabe'; })[0] || kann[0] || null;
  const mussAufgaben = muss.filter(function (a) { return a.art === 'aufgabe'; }).length;
  const teile = [anzahl_(alleTermine.length + ganztags.length, 'ein Termin', 'Termine'), anzahl_(mussAufgaben, 'eine Aufgabe', 'Aufgaben') + ' fällig'];
  if (e.wichtigeMails) teile.push(anzahl_(e.wichtigeMails, 'eine wichtige Mail', 'wichtige Mails'));
  const tagWort = e.istHeute ? 'Heute' : WOCHENTAGE_KURZ[wochentag_(heute)] + ' ' + datumKurz_(heute).slice(4);
  let zusammenfassung = tagWort + ': ' + teile.join(', ') + '.';
  if (top && feierabend) zusammenfassung += ' Morgen am besten zuerst: „' + top.titel + '“.';
  else if (top) zusammenfassung += ' Fang mit „' + top.titel + '“ an – das bringt dich ' + (e.istHeute ? 'heute' : 'an dem Tag') + ' am weitesten.';

  return {
    datum: heute,
    zusammenfassung: zusammenfassung,
    motivation: motivation_(e, jetzt, beginn, ende),
    hinweise: hinweise,
    reihenfolge: reihenfolge,
    naechster: naechster,
    ganztags: ganztags,
    nichtEingeplant: nichtEingeplant.map(function (a) { return a.titel; }),
    auslastung: { freiMin: freiMin, terminMin: terminMin, aufgabenMin: mussMin, prozent: prozent }
  };
}

function motivation_(e, jetzt, beginn, ende) {
  const n = e.erledigtHeute || 0;
  if (!e.istHeute) return 'Vorschau auf ' + WOCHENTAGE[wochentag_(e.datum)].replace(/^./, function (c) { return c.toUpperCase(); }) + ': So sieht der Tag bisher aus. Du kannst jetzt schon Luft einplanen.';
  if (ende - jetzt < 20) return n ? 'Feierabend in Sicht – und ' + n + ' Haken auf dem Konto. Was offen ist, planen wir morgen neu ein.' : 'Feierabend in Sicht. Was heute nicht geklappt hat, plane ich morgen mit dir neu ein.';
  if (n >= 5) return 'Du bist heute richtig im Flow – ' + n + ' Dinge erledigt. Gönn dir zwischendurch eine echte Pause.';
  if (n >= 1) return 'Schon ' + n + ' erledigt – das läuft. Weiter so, Schritt für Schritt.';
  if (jetzt < 12 * 60) return 'Ein guter Tag beginnt mit einem ersten kleinen Haken. Such dir die kürzeste Aufgabe und leg los.';
  return 'Noch nichts abgehakt? Kein Problem – eine einzige erledigte Aufgabe verändert, wie sich der Tag anfühlt.';
}

// ---------- Sprache / Freitext verstehen ----------

/**
 * Versteht diktierte oder getippte Sätze wie
 * „Termin morgen um 10 Uhr Zahnarzt“, „Idee: Newsletter mit Kundenstimmen“,
 * „Steuer abgeben bis Freitag wichtig 1 Stunde“.
 */
function textVerstehen_(text, heute, standardTyp) {
  const original = String(text || '').trim();
  let rest = ' ' + original.replace(/[,;!?]+/g, ' ').replace(/:(?!\d)/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const erg = { typ: standardTyp || 'aufgabe', titel: '', datum: null, zeit: null, endeZeit: null, dauer: null, prio: null };

  function weg(re) {
    const m = rest.match(re);
    if (!m) return null;
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return m;
  }

  // Art des Eintrags
  let m = weg(/^ (?:neue[rns]? )?(idee|notiz|merken|merke|termin|aufgabe|to-?do|erinnerung) /i);
  if (m) {
    const w = m[1].toLowerCase();
    erg.typ = /idee|notiz|merk/.test(w) ? 'idee' : (w === 'termin' ? 'termin' : 'aufgabe');
  } else if (weg(/^ erinnere mich(?: daran)?(?: dass| zu)? /i)) {
    erg.typ = 'aufgabe';
  }

  if (erg.typ !== 'idee') {
    // Datum
    if (weg(/ übermorgen(?= )/i)) erg.datum = datumPlusTage_(heute, 2);
    else if (weg(/ morgen(?: früh)?(?= )/i)) erg.datum = datumPlusTage_(heute, 1);
    else if (weg(/ heute(?: abend| nachmittag| vormittag)?(?= )/i)) erg.datum = heute;
    else if ((m = weg(new RegExp(' in ' + ZAHL_MUSTER + ' (tag|tagen|woche|wochen)(?= )', 'i')))) {
      const n = zahl_(m[1]) || 1;
      erg.datum = datumPlusTage_(heute, /woche/i.test(m[2]) ? n * 7 : n);
    } else if (weg(/ nächste woche(?= )/i)) {
      const wt = wochentag_(heute);
      erg.datum = datumPlusTage_(heute, ((8 - wt) % 7) || 7);
    } else if ((m = weg(/ (?:am |bis |bis zum |zum )?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?= )/i))) {
      erg.datum = datumBauen_(heute, Number(m[1]), Number(m[2]), m[3]);
    } else if ((m = weg(new RegExp(' (?:am |bis |bis zum |zum )?(\\d{1,2})\\.? (' + MONATE.join('|') + ')(?: (\\d{4}))?(?= )', 'i')))) {
      erg.datum = datumBauen_(heute, Number(m[1]), MONATE.indexOf(m[2].toLowerCase()) + 1, m[3]);
    } else if ((m = weg(new RegExp(' (?:am |bis |bis zum |nächsten |kommenden |diesen )?(' + WOCHENTAGE.join('|') + ')(?= )', 'i')))) {
      const ziel = WOCHENTAGE.indexOf(m[1].toLowerCase());
      erg.datum = datumPlusTage_(heute, ((ziel - wochentag_(heute) + 7) % 7) || 7);
    }

    // Uhrzeit (zuerst Zeitspanne „von 10 bis 11 Uhr“)
    const Z = ZAHL_MUSTER, MIN = '(?:[:.](\\d{2}))?';
    if ((m = weg(new RegExp(' von ' + Z + MIN + '(?: uhr)? bis ' + Z + MIN + '(?: uhr)?(?= )', 'i')))) {
      erg.zeit = uhrzeit_(zahl_(m[1]), m[2], false);
      erg.endeZeit = uhrzeit_(zahl_(m[3]), m[4], false);
    } else if ((m = weg(new RegExp(' um halb ' + Z + '(?: uhr)?(?= )', 'i')))) {
      erg.zeit = uhrzeit_(zahl_(m[1]) - 1, '30', false);
    } else if ((m = weg(new RegExp(' (?:um|ab|gegen) ' + Z + MIN + '( uhr)?(?= )', 'i')))) {
      erg.zeit = uhrzeit_(zahl_(m[1]), m[2], !!m[3] || !!m[2]);
    } else if ((m = weg(/ (\d{1,2})(?:[:.](\d{2}))? uhr(?= )/i)) || (m = weg(/ (\d{1,2}):(\d{2})(?= )/))) {
      erg.zeit = uhrzeit_(Number(m[1]), m[2], true);
    }

    // Dauer
    if (weg(/ (?:für |ca\. |circa |etwa )?(?:eine )?halbe stunde(?= )/i)) erg.dauer = 30;
    else if (weg(/ (?:für |ca\. |circa |etwa )?(?:anderthalb|eineinhalb) stunden?(?= )/i)) erg.dauer = 90;
    else if ((m = weg(new RegExp(' (?:für |ca\\. |circa |etwa )?' + Z + '(?:[,.](\\d))? ?(minuten|min\\.?|stunden|stunde|std\\.?)(?= )', 'i')))) {
      const wert = zahl_(m[1]) + (m[2] ? Number('0.' + m[2]) : 0);
      erg.dauer = Math.round(/^m/i.test(m[3]) ? wert : wert * 60);
    }
  }

  // Priorität (auch bei Ideen egal – wird dort ignoriert)
  if ((m = weg(/ prio(?:rität)? ?([123])(?= )/i))) erg.prio = Number(m[1]);
  else if (weg(/ (?:sehr )?(?:wichtig|dringend)(?= )|hohe priorität(?= )/i)) erg.prio = 1;
  else if (weg(/ (?:unwichtig|irgendwann|niedrige priorität)(?= )/i)) erg.prio = 3;

  // Titel säubern
  let titel = rest.replace(/\s+/g, ' ').trim()
    .replace(/^(?:ich muss|ich sollte|ich will|bitte|noch|dass ich)\s+/i, '')
    .replace(/\s+(?:am|um|für|bis|ab|zum|und)$/i, '')
    .replace(/^(?:am|um|für|bis|ab|zum|und)\s+/i, '')
    .replace(/[.\s]+$/, '');
  if (!titel) titel = original;
  erg.titel = titel.charAt(0).toUpperCase() + titel.slice(1);

  if (erg.typ === 'termin') {
    if (!erg.datum) erg.datum = heute;
    if (erg.zeit && !erg.endeZeit) erg.endeZeit = minZuZeit_(zeitZuMin_(erg.zeit) + (erg.dauer || 60));
  }
  return erg;
}

function datumBauen_(heute, tag, monat, jahr) {
  if (!(tag >= 1 && tag <= 31 && monat >= 1 && monat <= 12)) return null;
  let j = jahr ? Number(jahr) : Number(heute.slice(0, 4));
  if (j < 100) j += 2000;
  let iso = j + '-' + pad2_(monat) + '-' + pad2_(tag);
  if (!jahr && iso < heute) iso = (j + 1) + iso.slice(4);
  return iso;
}

function uhrzeit_(h, minuten, eindeutig) {
  if (h == null || isNaN(h)) return null;
  h = Math.floor(h);
  const m = minuten ? Number(minuten) : 0;
  // „um 3“ ohne „Uhr“ meint im Alltag fast immer nachmittags
  if (!eindeutig && h >= 1 && h <= 6) h += 12;
  if (h > 23 || m > 59) return null;
  return pad2_(h) + ':' + pad2_(m);
}
