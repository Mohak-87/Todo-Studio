/* Demo-Zentrale: simuliert MO, Sub-Agenten, Freigaben und eine Claude-Sitzung – rein im Browser, nichts verlässt das Gerät. */
'use strict';

const DemoZentrale = (() => {
  let nr = 0;
  const ereignisse = [];
  const jetzt = () => new Date().toISOString();
  const agenten = [
    ['aufgaben', 'Aufgaben-Agent', 'Legt Aufgaben in Google Tasks an, ändert sie und hakt sie ab. Löschen nur nach Freigabe.'],
    ['termine', 'Termin-Agent', 'Liest den Google Kalender und trägt neue Termine ein. Ändern und Löschen nur nach Freigabe.'],
    ['mails', 'Mail-Agent', 'Liest ungelesene Gmail-Nachrichten. Nur lesen – sendet und löscht nie.'],
    ['ideen', 'Ideen-Agent', 'Verwaltet den Ideen- und Erinnerungsspeicher.'],
    ['planer', 'Planer-Agent', 'Erstellt Tagesplan und morgendliches Briefing.'],
    ['impuls', 'Impuls-Agent', 'Meldet sich von selbst: Termin-Erinnerungen, neue wichtige Mails, Konflikte, freie Lücken – mit Vorschlag.'],
    ['freigabe', 'Freigabe-Wächter', 'Prüft jeden Vorschlag und lässt nur ausdrücklich freigegebene Schritte ausführen.'],
    ['waechter', 'Sitzungs-Wächter', 'Überwacht laufende Claude-Sitzungen auf Fehler, Zeitlimit und Stillstand.'],
    ['promptstudio', 'Prompt.Studio', 'Schreibt aus Ihren Aussagen einsatzbereite Prompts mit Ampel, Rückfragen und Platzhaltern – nur auf ausdrücklichen Wunsch („baue mir einen Prompt“, „verbessere meinen Prompt“). Führt nie selbst aus.'],
    ['bau', 'Bau-Leiter', 'Setzt einen freigegebenen Prompt in einer neuen Claude-Code-Sitzung um – je Projekt ein eigener Unterordner in Downloads. Meldet Zwischenstände, setzt nach Abbrüchen fort, testet nur auf Zuruf.'],
    ['bote', 'Briefkasten-Agent', 'Hält die Verbindung zum Google-Skript für Apple Watch und Briefing.']
  ].map(([id, name, aufgabe]) => ({ id, name, aufgabe, art: 'fest', status: 'bereit', zuletzt: jetzt(), letzteAktion: '' }));
  const z = { jarvis: { status: 'bereit' }, vorschlaege: [], sitzungen: [], chat: [], ordner: ['todo-studio', 'kunden-website'], maxSitzungen: 3, google: true,
    auftraege: [], aktiveAgenten: {}, ntfy: { an: false, kanal: 'jarvis-demo0000000000000000' } };
  const bibliothek = [];
  const KATALOG = window.DEMO_KATALOG || { version: 'leer', bereiche: [] };
  const katalogAgent = (id) => { for (const b of KATALOG.bereiche) { const a = b.agenten.find((x) => x.id === id); if (a) return { ...a, bereichName: b.name }; } return null; };

  function teamStarten(v) {
    const auftrag = { id: 'a' + (nr + 1), titel: v.titel, ablauf: v.ablauf, status: 'laeuft', start: jetzt(), schritte: v.schritte.map((s) => ({ agentId: s.agentId, name: s.name, status: 'geplant', fehler: '', ergebnisId: null })) };
    z.auftraege.push(auftrag);
    ereignis('auftrag');
    const texte = {"marketing.zielgruppe": "## Zielgruppen PLUGGED\n\n1. **Crews (16–25)** – wollen Bühne und Battle-Erfahrung. Kanal: Instagram, TikTok.\n2. **Fans & Familien** – wollen Show-Erlebnis. Kanal: Instagram, lokale Presse.\n3. **Tanzschulen** – wollen Sichtbarkeit für ihre Teams. Kanal: E-Mail, persönliche Ansprache.", "branding.slogan": "## Slogans\n\n- „Plug in. Stand out.“\n- „Eine Bühne. Alle Styles.“\n- „Dein Moment. Live in Krefeld.“ (Annahme: Austragung in Krefeld)\n\n**Empfehlung:** „Plug in. Stand out.“ – kurz, international, passt zum Namen.", "instagram.redaktionsplan": "## 4-Wochen-Plan Instagram\n\n| Woche | Reel | Story |\n|---|---|---|\n| 1 | Teaser Halle | Umfrage Lieblingsstyle |\n| 2 | Crew-Vorstellung | Countdown |\n| 3 | Jury-Reveal | Q&A |\n| 4 | Ticket-Endspurt | Behind the Scenes |"};
    auftrag.schritte.forEach((s, i) => {
      setTimeout(() => { s.status = 'arbeitet'; z.aktiveAgenten[s.agentId] = 'arbeitet'; ereignis('fachagent', { agent: s.agentId, status: 'arbeitet' }); ereignis('auftrag'); }, 1200 + i * 2600);
      setTimeout(() => {
        const id = 'b' + (nr + 1);
        bibliothek.push({ id, auftragId: auftrag.id, agentId: s.agentId, agentName: s.name, bereich: (katalogAgent(s.agentId) || {}).bereichName || '', titel: `${s.name}: ${auftrag.titel}`, zeit: jetzt(), inhalt: texte[s.agentId] || 'Demo-Ergebnis.', auszug: (texte[s.agentId] || '').replace(/[#*|]/g, '').slice(0, 200) });
        s.status = 'fertig'; s.ergebnisId = id; z.aktiveAgenten[s.agentId] = 'fertig';
        ereignis('fachagent', { agent: s.agentId, status: 'fertig' }); ereignis('auftrag');
        if (auftrag.schritte.every((x) => x.status === 'fertig')) {
          auftrag.status = 'fertig'; ereignis('auftrag');
          (async () => {
            agent('jarvis', 'denkt', 'Fasst zusammen');
            await tippen('Das Team ist fertig. Kernaussage: Drei Zielgruppen, Leitmotiv „Plug in. Stand out.“, dazu ein Vier-Wochen-Plan für Instagram. Mein Vorschlag: zuerst der Teaser in Woche 1 – soll ich dafür den Hook-Schreiber beauftragen?');
            chat('jarvis', 'Das Team ist fertig. Kernaussage: Drei Zielgruppen, Leitmotiv „Plug in. Stand out.“, dazu ein Vier-Wochen-Plan für Instagram. Alles liegt in der Bibliothek.\nMein Vorschlag: zuerst der Teaser in Woche 1 – soll ich dafür den Hook-Schreiber beauftragen?', { sprechen: 'Das Team ist fertig. Alles liegt in der Bibliothek.' });
            agent('jarvis', 'bereit', '');
          })();
        }
      }, 3400 + i * 2600);
    });
  }

  function ereignis(art, daten = {}) { ereignisse.push({ nr: ++nr, zeit: jetzt(), art, ...daten }); }
  async function tippen(text) { // wie die echte Zentrale: Antwort erscheint schon beim Schreiben
    for (let i = 12; i < text.length; i += 12) { ereignis('teil', { text: text.slice(0, i) }); await new Promise((r) => setTimeout(r, 90)); }
  }
  function chat(von, text, extra = {}) {
    const m = { id: 'd' + (nr + 1), von, text, zeit: jetzt(), ...extra };
    z.chat.push(m);
    ereignis('chat', { nachricht: m });
  }
  function agent(id, status, aktion) {
    const a = id === 'jarvis' ? z.jarvis : agenten.find((x) => x.id === id);
    if (!a) return;
    a.status = status; if (aktion) a.letzteAktion = aktion; a.zuletzt = jetzt();
    ereignis('agent', { agent: id, status });
  }
  function sitzungAgenten() {
    return z.sitzungen.map((s) => ({
      id: 'sitzung:' + s.id, sitzungId: s.id, art: 'sitzung', name: 'Sitzung: ' + s.titel, aufgabe: s.ziel,
      status: s.status, zuletzt: jetzt(), letzteAktion: s.letzteZeilen[s.letzteZeilen.length - 1] || ''
    }));
  }

  chat('jarvis', 'Guten Abend. Dies ist die Demo: Ich simuliere Zentrale, Sub-Agenten und Claude-Sitzungen. Versuchen Sie etwa „Prüfe die Website auf kaputte Links“ oder „Notiere: Steuerberater anrufen“.');
  setTimeout(() => agent('bote', 'arbeitet', 'Verbindung zum Google-Skript prüfen'), 3000);
  setTimeout(() => agent('bote', 'bereit', 'Verbindung steht'), 5000);
  setTimeout(() => { agent('impuls', 'meldet', 'Neue wichtige Mail'); chat('jarvis', 'Neue wichtige Mail von Sabine Müller: „Rückfrage zum Angebot“. Soll ich daraus eine Aufgabe für heute machen?', { sprechen: 'Neue wichtige Mail von Sabine Müller.', impuls: true }); }, 9000);

  function sitzungStarten(s) {
    const sitz = {
      id: 's' + (nr + 1), titel: s.titel, ziel: s.ziel, ordner: s.ordner, rechte: s.rechte, hoechstMin: s.hoechstMin, status: 'laeuft',
      haengt: false, start: jetzt(), letzteZeilen: ['Gestartet in ' + s.ordner], ausgabe: ['Gestartet in ' + s.ordner], auftrag: s.auftrag, ergebnis: '', fehler: ''
    };
    z.sitzungen.push(sitz);
    agent('waechter', 'arbeitet', '1 Sitzung unter Beobachtung');
    const schritte = ['→ Glob **/*.html', '→ Read index.html', '→ Read kontakt.html', 'Prüfe 42 Links …', '→ Grep href="http', '2 defekte Links gefunden: /impressum-alt, /preise-2024'];
    schritte.forEach((zeile, i) => setTimeout(() => {
      if (sitz.status !== 'laeuft') return;
      sitz.ausgabe.push(zeile); sitz.letzteZeilen = sitz.ausgabe.slice(-4); ereignis('ausgabe', { sitzungId: sitz.id });
    }, 1800 * (i + 1)));
    setTimeout(() => {
      if (sitz.status !== 'laeuft') return;
      sitz.status = 'fertig'; sitz.ende = jetzt();
      sitz.ergebnis = 'Ich habe 42 Links geprüft. Zwei verweisen ins Leere: /impressum-alt und /preise-2024. Geändert habe ich nichts – Vorschlag: auf /impressum und /preise umleiten.';
      ereignis('sitzung', { sitzungId: sitz.id });
      agent('waechter', 'bereit', '');
      chat('jarvis', `Sitzung „${sitz.titel}“ ist abgeschlossen.\n${sitz.ergebnis}`, { sprechen: `Die Sitzung ${sitz.titel} ist abgeschlossen. Zwei defekte Links.` });
    }, 1800 * (schritte.length + 1));
  }

  async function nachricht(text) {
    chat('nutzer', text);
    agent('jarvis', 'denkt', 'Denkt nach');
    await new Promise((r) => setTimeout(r, 1400));
    if (/prompt/i.test(text)) {
      chat('jarvis', 'Sehr wohl. Prompt.Studio arbeitet daran – ich lege Ihnen den Prompt gleich vor.', { sprechen: 'Sehr wohl.' });
      agent('jarvis', 'bereit', '');
      agent('promptstudio', 'arbeitet', 'Schreibt Ihren Prompt');
      await new Promise((r) => setTimeout(r, 2600));
      agent('promptstudio', 'bereit', 'Prompt vorgelegt');
      const prompt = '<role>\nDu bist eine erfahrene Web-Entwicklerin für schlanke, lokale Apps.\n</role>\n<context>\nDer Nutzer möchte eine einfache Notiz-App, die nur im Browser läuft.\n</context>\n<task>\n1. Baue eine Seite zum Anlegen, Bearbeiten und Löschen von Notizen.\n2. Speichere die Notizen im Browser (localStorage).\n</task>\n<constraints>\n- Keine kostenpflichtigen Dienste, kein Server.\n</constraints>\n<output_format>\nEin Ordner mit index.html, style.css und app.js sowie eine kurze Startanleitung.\n</output_format>\n<edge_cases>\n- Leere Notizen werden nicht gespeichert.\n</edge_cases>';
      chat('jarvis', 'Ampel: Grün – Einsatzbereit, klar und vollständig.\n\nZielordner: C:\\Users\\…\\Downloads\\notiz-app – die neue Sitzung legt erst mit Ihrem Bau-Befehl los.\n\n(Demo: In der echten Zentrale folgt auf „baue die App“ eine Nachfrage, dann baut eine neue Claude-Sitzung.)',
        { sprechen: 'Ihr Prompt liegt vor. Ampel Grün.', prompt });
      return;
    }
    if (/kampagne|werbung|marketing|plane|event/i.test(text)) {
      const team = ['marketing.zielgruppe', 'branding.slogan', 'instagram.redaktionsplan'].map((id) => katalogAgent(id)).filter(Boolean);
      const v = {
        id: 'v' + (nr + 1), titel: 'Werbung für PLUGGED', begruendung: 'Drei Spezialisten nacheinander – jeder baut auf dem vorherigen auf.', ablauf: 'kette',
        schritte: team.map((a) => ({ typ: 'agent', agentId: a.id, name: a.name, bereich: a.bereichName, rechte: a.rechte, hoechstMin: 5, briefing: `Für PLUGGED (Tanzwettbewerb): ${a.aufgabe}.` })),
        pruefsumme: 'demo' + nr, status: 'offen', erstellt: jetzt()
      };
      z.vorschlaege.push(v);
      agent('freigabe', 'wartet', 'Wartet auf Ihre Freigabe');
      ereignis('vorschlag', { vorschlag: v });
      await tippen('Sehr wohl. Ich stelle ein Team aus drei Fach-Agenten zusammen: Zielgruppen-Analyst, Slogan-Schmied und Redaktionsplaner Instagram – nacheinander. Darf ich?');
      chat('jarvis', 'Sehr wohl. Ich stelle ein Team aus drei Fach-Agenten zusammen: Zielgruppen-Analyst, Slogan-Schmied und Redaktionsplaner Instagram – nacheinander, jeder baut auf dem vorherigen auf. Darf ich?',
        { sprechen: 'Ich stelle ein Team aus drei Fach-Agenten zusammen. Darf ich?', vorschlagId: v.id });
    } else if (/prüf|sitzung|claude|code|link|test|website|repo/i.test(text)) {
      const v = {
        id: 'v' + (nr + 1), titel: 'Website auf defekte Links prüfen', begruendung: 'Eine lesende Sitzung genügt; geändert wird nichts.',
        schritte: [{ typ: 'sitzung', titel: 'Link-Prüfung', ziel: 'Alle internen und externen Links der Kunden-Website prüfen und defekte auflisten.', ordner: 'kunden-website', rechte: 'lesen', hoechstMin: 15, auftrag: 'Prüfe alle Links der Website und liste defekte auf. Ändere nichts.' }],
        pruefsumme: 'demo' + nr, status: 'offen', erstellt: jetzt()
      };
      z.vorschlaege.push(v);
      agent('freigabe', 'wartet', 'Wartet auf Ihre Freigabe');
      ereignis('vorschlag', { vorschlag: v });
      await tippen('Sehr wohl. Ich schlage eine Claude-Code-Sitzung im Ordner „kunden-website“ vor: nur lesen, höchstens 15 Minuten, Ergebnis ist eine Liste defekter Links. Geändert wird nichts. Darf ich?');
      chat('jarvis', 'Sehr wohl. Ich schlage eine Claude-Code-Sitzung im Ordner „kunden-website“ vor: nur lesen, höchstens 15 Minuten, Ergebnis ist eine Liste defekter Links. Geändert wird nichts. Darf ich?',
        { sprechen: 'Ich schlage eine lesende Sitzung vor. Darf ich?', vorschlagId: v.id });
    } else if (!/(\b(erstell|anleg|leg|trag|speicher|setz|plan|mach)\w*\b[^.?!]{0,40}\b(aufgabe|todo|to-do|termin|idee|notiz|erinnerung|kalender|liste)\b|\b(aufgabe|todo|to-do|termin|idee|notiz|erinnerung)\w*\b[^.?!]{0,30}\b(erstell|anleg|eintrag|notier|aufschreib|speicher|festhalt|anlegen|eintragen)\w*|\b(notier\w*|schreib\w*\s+(\w+\s+){0,3}auf|merk\w*\s+(dir|mir)|halt\w*\s+(\w+\s+)?fest|vergiss\s+nicht)\b|\berinner\w*\s+(mich|mir)\b|^(aufgabe|todo|to-do|termin|idee|notiz|erinnerung)\s*:)/i.test(text)) {
      const antwort = 'Gern. In der Demo kann ich nur so tun, als ob – mit Ihrer Zentrale antworte ich hier ganz normal auf Fragen und Gedanken. Eintragen tue ich nur, wenn Sie es sagen, etwa „Erstelle eine Aufgabe: Steuerberater anrufen“.';
      await tippen(antwort);
      chat('jarvis', antwort, { sprechen: 'Gern.' });
    } else {
      agent('aufgaben', 'arbeitet', 'Aufgabe anlegen');
      await DemoStudio.aufruf('schnell', { text: text.replace(/^notiere:?\s*/i, ''), typ: 'aufgabe' }).catch(() => {});
      agent('aufgaben', 'bereit', 'Aufgabe angelegt');
      await tippen('Erledigt. „' + text.replace(/^notiere:?\s*/i, '') + '“ steht auf Ihrer Liste. Sonst noch etwas?');
      chat('jarvis', 'Erledigt. „' + text.replace(/^notiere:?\s*/i, '') + '“ steht auf Ihrer Liste. Sonst noch etwas?', { sprechen: 'Erledigt.' });
    }
    agent('jarvis', 'bereit', '');
  }

  function zustand() { return { ...z, agenten: agenten.concat(sitzungAgenten()), letzteNr: nr, katalogVersion: KATALOG.version }; }
  const kopie = (x) => JSON.parse(JSON.stringify(x));

  function antworten(methode, pfad, body) {
    if (pfad === '/api/zustand') return kopie(zustand());
    if (pfad === '/api/katalog') return KATALOG;
    if (pfad.startsWith('/api/bibliothek/eintrag')) { const id = new URLSearchParams(pfad.split('?')[1]).get('id'); return kopie(bibliothek.find((b) => b.id === id)); }
    if (pfad.startsWith('/api/bibliothek')) { const q = (new URLSearchParams(pfad.split('?')[1]).get('q') || '').toLowerCase(); return kopie(bibliothek.filter((b) => !q || (b.titel + b.auszug).toLowerCase().includes(q)).reverse()); }
    if (pfad === '/api/einstellung') { z.ntfy.an = !!body.ntfy; return { ntfy: z.ntfy }; }
    if (pfad.startsWith('/api/ereignisse')) {
      const seit = Number(new URLSearchParams(pfad.split('?')[1]).get('seit') || 0);
      return { ereignisse: kopie(ereignisse.filter((e) => e.nr > seit)), letzteNr: nr };
    }
    if (pfad === '/api/nachricht') { nachricht(body.text); return { ok: true }; }
    if (pfad === '/api/freigabe') {
      const v = z.vorschlaege.find((x) => x.id === body.id);
      if (!v || !['offen', 'zurueckgestellt'].includes(v.status)) throw new Error('Über diesen Vorschlag wurde bereits entschieden.');
      if (body.entscheidung === 'ja') {
        v.status = 'freigegeben';
        agent('freigabe', 'bereit', 'Freigegeben');
        chat('jarvis', v.schritte[0].typ === 'agent' ? 'Freigabe erhalten. Das Team arbeitet – ich melde mich mit den Ergebnissen.' : 'Freigabe erhalten. „' + v.schritte[0].titel + '“ läuft.', { sprechen: 'Freigabe erhalten. Ich kümmere mich darum.' });
        if (v.schritte[0].typ === 'agent') teamStarten(v); else v.schritte.forEach(sitzungStarten);
      } else if (body.entscheidung === 'verwerfen') {
        v.status = 'verworfen'; ereignis('entscheidung');
      } else {
        v.status = 'zurueckgestellt';
        agent('freigabe', 'bereit', 'Zurückgestellt');
        chat('jarvis', 'Verstanden. Ich unternehme nichts. Der Vorschlag bleibt zurückgestellt sichtbar.', { sprechen: 'Verstanden. Ich unternehme nichts.' });
      }
      return { id: v.id, status: v.status };
    }
    if (pfad === '/api/sitzung/stopp') {
      const s = z.sitzungen.find((x) => x.id === body.id);
      s.status = 'gestoppt'; s.ausgabe.push('Gestoppt per Stopp-Knopf.'); s.letzteZeilen = s.ausgabe.slice(-4);
      agent('waechter', 'bereit', '');
      ereignis('sitzung', { sitzungId: s.id });
      return kopie(s);
    }
    if (pfad.startsWith('/api/sitzung')) {
      const id = new URLSearchParams(pfad.split('?')[1]).get('id');
      return kopie(z.sitzungen.find((x) => x.id === id));
    }
    throw new Error('Demo: unbekannter Pfad ' + pfad);
  }

  return {
    aufruf(methode, pfad, body) {
      if (pfad.startsWith('/api/ereignisse')) {
        // Wie die echte Zentrale: sofort antworten, sobald es etwas Neues gibt (höchstens 2 s warten)
        const seit = Number(new URLSearchParams(pfad.split('?')[1]).get('seit') || 0);
        return new Promise((ok) => {
          const ende = Date.now() + 2000;
          const pruefen = () => (nr > seit || Date.now() > ende ? ok(antworten(methode, pfad, body)) : setTimeout(pruefen, 40));
          setTimeout(pruefen, 40);
        });
      }
      return new Promise((ok, fehler) => {
        setTimeout(() => { try { ok(antworten(methode, pfad, body)); } catch (err) { fehler(err); } }, 150);
      });
    }
  };
})();
