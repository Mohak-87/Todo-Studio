/* To-Do-Studio – Demo-Modus: Beispieldaten im Browser, nichts verlässt das Gerät, nichts wird gespeichert. */
'use strict';

const DemoStudio = (() => {
  const heute = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  let nr = 100;
  const neueId = () => 'demo' + (nr++);
  const h = heute();

  const termine = [
    { id: 't1', titel: 'Team-Abstimmung', datum: h, start: '09:00', ende: '10:00', ort: 'Video-Call' },
    { id: 't2', titel: 'Kundentermin Müller', datum: h, start: '11:00', ende: '12:30', ort: 'Büro' },
    { id: 't3', titel: 'Rückruf Bank', datum: h, start: '12:00', ende: '12:20', ort: '' },
    { id: 't4', titel: 'Training', datum: h, start: '18:30', ende: '19:30', ort: 'Studio' },
    { id: 't5', titel: 'Geburtstag Lena', datum: h, ganztags: true },
    { id: 't6', titel: 'Zahnarzt', datum: datumPlusTage_(h, 1), start: '08:30', ende: '09:15', ort: 'Praxis Dr. Weber' }
  ];
  const aufgaben = [
    { id: 'a1', titel: 'Angebot für Projekt Nord fertigstellen', faellig: h, prio: 1, dauer: 90, notizen: '' },
    { id: 'a2', titel: 'Steuerunterlagen sortieren', faellig: datumPlusTage_(h, -2), prio: 2, dauer: 45, notizen: '' },
    { id: 'a3', titel: 'Präsentation Folien 3–7 überarbeiten', faellig: h, prio: 2, dauer: 60, notizen: '' },
    { id: 'a4', titel: 'Geschenk für Lena besorgen', faellig: h, prio: 1, dauer: 20, notizen: '' },
    { id: 'a5', titel: 'Reisekosten einreichen', faellig: null, prio: 3, dauer: 15, notizen: '' },
    { id: 'a6', titel: 'Website-Texte gegenlesen', faellig: datumPlusTage_(h, 2), prio: 2, dauer: 30, notizen: '' }
  ];
  const erledigt = [{ id: 'a0', titel: 'Rechnung an Kunde Schulz geschickt', faellig: h, prio: 2, dauer: 10, erledigt: true }];
  let briefing = null, letzteArt = 'frage';
  let ideen = [
    { id: 'i1', text: 'Newsletter mit Kundenstimmen starten', erstellt: datumPlusTage_(h, -3) + 'T19:12' },
    { id: 'i2', text: 'Wochenrückblick jeden Freitag um 16 Uhr', erstellt: datumPlusTage_(h, -1) + 'T08:40' }
  ];
  const mails = [
    { id: 'm1', threadId: 'm1', von: 'Sabine Müller', betreff: 'Rückfrage zum Angebot', auszug: 'Hallo, könnten Sie mir bis heute Abend noch die überarbeitete Version schicken? …', datum: h + 'T08:12', wichtig: true, link: 'https://mail.google.com/' },
    { id: 'm2', threadId: 'm2', von: 'Steuerbüro Klein', betreff: 'Fehlende Belege 2025', auszug: 'Für den Abschluss fehlen uns noch folgende Unterlagen …', datum: datumPlusTage_(h, -1) + 'T16:40', wichtig: true, link: 'https://mail.google.com/' },
    { id: 'm3', threadId: 'm3', von: 'Paketdienst', betreff: 'Deine Sendung kommt heute', auszug: 'Zustellung zwischen 14 und 16 Uhr.', datum: h + 'T07:01', wichtig: false, link: 'https://mail.google.com/' }
  ];

  function terminVoll(t) {
    return Object.assign({ ganztags: false, ort: '', notizen: '', serie: false, link: '' }, t, {
      startMin: t.ganztags ? null : zeitZuMin_(t.start), endeMin: t.ganztags ? null : zeitZuMin_(t.ende)
    });
  }
  function jetztMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  const aktionen = {
    'ping': () => ({ name: 'To-Do-Studio (Demo)' }),
    'heute': (p) => {
      const tt = termine.filter((t) => t.datum === h).map(terminVoll);
      const plan = planErstellen_({
        datum: h, istHeute: true, jetztMin: jetztMin(), arbeitsbeginn: p.arbeitsbeginn, arbeitsende: p.arbeitsende,
        termine: tt, aufgaben, wichtigeMails: mails.filter((m) => m.wichtig).length, erledigtHeute: erledigt.length, ideenAnzahl: ideen.length
      });
      return {
        datum: h, jetztMin: jetztMin(), termine: tt, aufgaben: { offen: aufgaben.slice(), erledigtHeute: erledigt.slice() },
        mails: mails.slice(), ideenAnzahl: ideen.length, plan, probleme: [],
        claude: { online: true, briefing }
      };
    },
    'termine.liste': (p) => termine.filter((t) => t.datum === p.von).map(terminVoll),
    'termin.neu': (p) => {
      const t = { id: neueId(), titel: p.titel, datum: p.datum, start: p.start || null, ende: p.ende || (p.start ? minZuZeit_(zeitZuMin_(p.start) + 60) : null), ganztags: !p.start, ort: p.ort || '', notizen: p.notizen || '' };
      termine.push(t); return terminVoll(t);
    },
    'termin.aendern': (p) => {
      if (!p.bestaetigt) throw new Error('Sicherheitsstopp: ohne Bestätigung keine Änderung.');
      const t = termine.find((x) => x.id === p.id);
      Object.assign(t, { titel: p.titel, datum: p.datum, start: p.start || null, ende: p.ende || (p.start ? minZuZeit_(zeitZuMin_(p.start) + 60) : null), ganztags: !p.start, ort: p.ort, notizen: p.notizen });
      return terminVoll(t);
    },
    'termin.loeschen': (p) => {
      if (!p.bestaetigt) throw new Error('Sicherheitsstopp: ohne Bestätigung kein Löschen.');
      termine.splice(termine.findIndex((x) => x.id === p.id), 1); return { geloescht: p.id };
    },
    'aufgabe.neu': (p) => { const a = { id: neueId(), titel: p.titel, faellig: p.faellig || null, prio: Number(p.prio) || 2, dauer: Number(p.dauer) || 30, notizen: p.notizen || '' }; aufgaben.push(a); return a; },
    'aufgabe.aendern': (p) => {
      const a = aufgaben.find((x) => x.id === p.id) || erledigt.find((x) => x.id === p.id);
      ['titel', 'notizen', 'prio', 'dauer'].forEach((k) => { if (p[k] != null) a[k] = k === 'prio' || k === 'dauer' ? Number(p[k]) : p[k]; });
      if (p.faellig !== undefined) a.faellig = p.faellig || null;
      return a;
    },
    'aufgabe.erledigt': (p) => {
      if (p.erledigt) { const i = aufgaben.findIndex((x) => x.id === p.id); const [a] = aufgaben.splice(i, 1); a.erledigt = true; erledigt.push(a); return a; }
      const i = erledigt.findIndex((x) => x.id === p.id); const [a] = erledigt.splice(i, 1); a.erledigt = false; aufgaben.push(a); return a;
    },
    'aufgabe.loeschen': (p) => { aufgaben.splice(aufgaben.findIndex((x) => x.id === p.id), 1); return { geloescht: p.id }; },
    'ideen.liste': () => ideen.slice(),
    'idee.neu': (p) => { const i = { id: neueId(), text: p.text, erstellt: h + 'T12:00' }; ideen.unshift(i); return i; },
    'idee.aendern': (p) => { ideen.find((x) => x.id === p.id).text = p.text; return { id: p.id }; },
    'idee.loeschen': (p) => { ideen = ideen.filter((x) => x.id !== p.id); return { geloescht: p.id }; },
    'idee.zuAufgabe': (p) => { const i = ideen.find((x) => x.id === p.id); ideen = ideen.filter((x) => x.id !== p.id); return aktionen['aufgabe.neu']({ titel: i.text }); },
    'mails.liste': () => mails.slice(),
    'mail.zuAufgabe': (p) => { const m = mails.find((x) => x.id === p.id); return aktionen['aufgabe.neu']({ titel: 'Mail: ' + m.betreff, faellig: h, dauer: 10 }); },
    'schnell': (p) => {
      const v = textVerstehen_(p.text, h, p.typ);
      if (v.typ === 'idee') return { typ: 'idee', verstanden: v, eintrag: aktionen['idee.neu']({ text: p.text.replace(/^\s*(neue\s+)?(idee|notiz|merken?)\s*[:,-]?\s*/i, '') }) };
      if (v.typ === 'termin') return { typ: 'termin', verstanden: v, brauchtBestaetigung: true };
      return { typ: 'aufgabe', verstanden: v, eintrag: aktionen['aufgabe.neu']({ titel: v.titel, faellig: v.datum, prio: v.prio, dauer: v.dauer }) };
    },
    'claude.fragen': (p) => { letzteArt = p.art; return { id: neueId(), frage: p.frage }; },
    'claude.antwort': () => {
      const antwort = 'Demo-Antwort: Im echten Studio antwortet hier Claude über den Helfer auf deinem PC.\n' +
        'Mein Vorschlag für heute: Starte direkt nach der Team-Abstimmung mit dem Angebot für Projekt Nord – das ist dein wichtigster Punkt. ' +
        'Das Geschenk für Lena passt gut in die Lücke nach dem Kundentermin. Die Präsentation würde ich auf morgen früh schieben, sonst wird es eng. Du schaffst das!';
      if (letzteArt === 'briefing') briefing = { datum: h, text: antwort, erstellt: new Date().toISOString() };
      return { status: 'fertig', antwort };
    }
  };

  return {
    aufruf(action, daten) {
      return new Promise((ok, fehler) => {
        setTimeout(() => {
          try {
            if (!aktionen[action]) throw new Error('Im Demo-Modus nicht verfügbar: ' + action);
            ok(JSON.parse(JSON.stringify(aktionen[action](daten || {}))));
          } catch (err) { fehler(err); }
        }, 250);
      });
    }
  };
})();
