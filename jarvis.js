/* Todo Studio – MO: Gespräch, Zentrale auf dem Laptop, Freigaben, Claude-Sitzungen, Sprache */
'use strict';

const Jarvis = (() => {
  const $ = (s) => document.querySelector(s);
  const { esc, toast } = Studio;
  const verlaufEl = $('#verlauf');
  const eingabe = $('#eingabeText');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = 'speechSynthesis' in window ? window.speechSynthesis : null;

  // Für die Wolke, solange die Zentrale (noch) nicht antwortet
  const STANDARD_AGENTEN = [
    ['aufgaben', 'Aufgaben-Agent', 'Legt Aufgaben in Google Tasks an, ändert sie und hakt sie ab.'],
    ['termine', 'Termin-Agent', 'Liest den Kalender und trägt Termine ein. Ändern/Löschen nur nach Freigabe.'],
    ['mails', 'Mail-Agent', 'Liest ungelesene Mails. Nur lesen – sendet nie.'],
    ['ideen', 'Ideen-Agent', 'Verwaltet den Ideenspeicher.'],
    ['planer', 'Planer-Agent', 'Tagesplan und Briefing.'],
    ['impuls', 'Impuls-Agent', 'Meldet sich von selbst mit Hinweisen und Vorschlägen.'],
    ['freigabe', 'Freigabe-Wächter', 'Lässt nur ausdrücklich Freigegebenes ausführen.'],
    ['waechter', 'Sitzungs-Wächter', 'Überwacht Claude-Sitzungen.'],
    ['bote', 'Briefkasten-Agent', 'Verbindung zum Google-Skript für Watch & Briefing.']
  ].map(([id, name, aufgabe]) => ({ id, name, aufgabe, art: 'fest', status: 'getrennt' }));

  const j = {
    verbunden: null, warVerbunden: false, zustand: null, letzteNr: 0, lokal: [], gezeigt: new Set(),
    lauf: 0, aktualisierenTimer: null, typ: 'aufgabe', hinweisOffline: false, ersteRunde: true
  };
  let agentenStand = { agenten: STANDARD_AGENTEN, jarvis: { status: 'getrennt' } };

  // ---------- Verbindung ----------
  function zentraleBereit() { const c = Studio.cfg; return !!(c.zentrale && (c.zentrale === 'demo' || c.zentraleSchluessel)); }

  async function zentrale(methode, pfad, body) {
    const c = Studio.cfg;
    if (c.zentrale === 'demo') return DemoZentrale.aufruf(methode, pfad, body);
    const res = await fetch(c.zentrale + pfad, {
      method: methode,
      headers: { Authorization: 'Bearer ' + c.zentraleSchluessel, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(pfad.startsWith('/api/ereignisse') || pfad === '/api/neustart' ? 40000 : 15000)
    });
    let r;
    try { r = await res.json(); } catch (e) { throw new Error('Zentrale antwortet unerwartet (HTTP ' + res.status + ').'); }
    if (!r.ok) throw new Error(r.fehler || 'Fehler der Zentrale');
    return r.daten;
  }

  function statusSetzen(text) { $('#chatStatus').textContent = text; }

  function verbindungAnzeigen() {
    const bereit = zentraleBereit();
    Studio.pille('#pilleZentrale', j.verbunden ? 'an' : (bereit ? 'aus' : ''),
      j.verbunden ? 'Zentrale verbunden' : bereit ? 'Zentrale nicht erreichbar' : 'Zentrale nicht eingerichtet');
    document.dispatchEvent(new CustomEvent('studio:daten'));
    $('#typWahl').hidden = true; // Art wird aus dem Satz erkannt („Erstelle eine Aufgabe …“, „Merke dir die Idee …“)
    eingabe.placeholder = j.verbunden ? 'Womit kann ich dienen?' : 'Zentrale offline – Nachricht geht in den Briefkasten …';
    if (!j.verbunden) statusSetzen(bereit ? 'Zentrale offline' : 'nur Todos');
  }

  async function verbinden() {
    const lauf = ++j.lauf;
    if (!zentraleBereit()) {
      j.verbunden = false;
      verbindungAnzeigen();
      if (!j.hinweisOffline) {
        j.hinweisOffline = true;
        lokal('jarvis', 'Guten Tag. Die Zentrale auf Ihrem Laptop ist noch nicht eingerichtet. Bis dahin notiere ich Aufgaben, Termine und Ideen direkt in Google. Claude-Aufgaben pausieren.');
      }
      wolkeAktualisieren();
      return;
    }
    try {
      const z = await zentrale('GET', '/api/zustand');
      if (lauf !== j.lauf) return;
      j.zustand = z;
      j.letzteNr = z.letzteNr;
      const wiederda = j.verbunden === false && j.warVerbunden;
      j.verbunden = true; j.warVerbunden = true; j.hinweisOffline = false;
      verbindungAnzeigen();
      statusSetzen(z.jarvis && z.jarvis.status === 'denkt' ? 'denkt …' : 'bereit');
      z.chat.forEach((m) => j.gezeigt.add(m.id));
      if (wiederda) lokal('jarvis', 'Verbindung zur Zentrale wiederhergestellt. Zu Ihren Diensten.', true);
      allesZeichnen();
      lauschen(lauf);
    } catch (err) {
      if (lauf !== j.lauf) return;
      const warAn = j.verbunden;
      j.verbunden = false;
      verbindungAnzeigen();
      if (warAn !== false || !j.hinweisOffline) {
        j.hinweisOffline = true;
        lokal('jarvis', 'Die Zentrale auf Ihrem Laptop antwortet nicht (' + err.message + '). Claude-Aufgaben starten in dieser Zeit nicht. Ihre Todos funktionieren weiter – ich melde mich, sobald die Verbindung steht.', warAn === true);
      }
      agentenStand = { agenten: STANDARD_AGENTEN, jarvis: { status: 'getrennt' } };
      wolkeAktualisieren();
      setTimeout(() => { if (lauf === j.lauf) verbinden(); }, 15000);
    }
  }

  async function lauschen(lauf) {
    while (lauf === j.lauf && j.verbunden) {
      try {
        const r = await zentrale('GET', '/api/ereignisse?seit=' + j.letzteNr);
        if (lauf !== j.lauf) return;
        j.letzteNr = r.letzteNr;
        let auffrischen = false;
        for (const e of r.ereignisse) {
          if (e.art === 'teil') { j.teil = e.text; chatZeichnen(); continue; } // MO schreibt gerade
          if (e.art === 'fachagent') {
            if (j.zustand) { j.zustand.aktiveAgenten = Object.assign({}, j.zustand.aktiveAgenten, { [e.agent]: e.status }); }
            if (window.Wolke && Wolke.setzeAktive) Wolke.setzeAktive(j.zustand ? j.zustand.aktiveAgenten : {});
            continue;
          }
          if (e.art === 'chat' && e.nachricht) nachrichtEmpfangen(e.nachricht);
          else auffrischen = true;
          if (e.art === 'agent' && e.agent === 'jarvis') {
            statusSetzen(e.status === 'denkt' ? 'denkt …' : 'bereit');
            if (j.zustand && j.zustand.jarvis) { j.zustand.jarvis.status = e.status; chatZeichnen(); }
          }
        }
        if (auffrischen || r.ereignisse.length) zustandAuffrischen();
      } catch (err) {
        if (lauf !== j.lauf) return;
        j.verbunden = false;
        verbindungAnzeigen();
        return verbinden();
      }
    }
  }

  function zustandAuffrischen() {
    clearTimeout(j.aktualisierenTimer);
    j.aktualisierenTimer = setTimeout(async () => {
      try { j.zustand = await zentrale('GET', '/api/zustand'); allesZeichnen(); } catch (e) { /* nächste Runde */ }
    }, 400);
  }

  function nachrichtEmpfangen(m) {
    if (j.gezeigt.has(m.id)) return;
    j.gezeigt.add(m.id);
    if (m.von === 'jarvis') { j.teil = null; if (j.zustand && j.zustand.jarvis) j.zustand.jarvis.status = 'bereit'; }
    if (j.zustand) j.zustand.chat.push(m);
    // Spricht MO über Orte (Nachrichten, Länder, Städte), erscheint die Erdkugel – nur bei frischen Nachrichten
    if (m.von === 'jarvis' && Array.isArray(m.orte) && m.orte.length && window.Wolke && Wolke.globus && Date.now() - Date.parse(m.zeit || 0) < 120000) {
      Wolke.globus(m.orte);
      if (innerWidth <= 860) chatUmschalten(false); // Handy: die Kugel braucht den Platz, die Antwort bleibt im Chat
    }
    if (m.von === 'jarvis') sprechen(m.sprechen || (m.text.length < 160 ? m.text : ''));
    if (m.von === 'jarvis' && !document.body.classList.contains('chat-offen')) { j.ungelesen = (j.ungelesen || 0) + 1; ungelesenZeigen(); }
    else if (m.von === 'nutzer') eingabe.value = '';
    chatZeichnen();
  }

  // ---------- Briefkasten: offline gesendete Nachrichten, bis die Zentrale sie übernommen hat ----------
  const BK = 'studio.briefkasten';
  function briefkasten() { try { return JSON.parse(localStorage.getItem(BK) || '[]'); } catch { return []; } }
  function briefkastenSpeichern(l) { try { localStorage.setItem(BK, JSON.stringify(l.slice(-50))); } catch { /* egal */ } }
  function briefkastenMerken(e) { briefkastenSpeichern(briefkasten().concat([e])); chatZeichnen(); }
  /** Nachrichten, die die Zentrale schon übernommen hat (nachgereicht im Chat), aus dem Briefkasten nehmen. */
  function briefkastenAbgleichen() {
    if (!j.zustand) return;
    const angekommen = new Set(j.zustand.chat.filter((m) => m.von === 'nutzer' && m.nachgereicht).map((m) => m.text.trim()));
    const rest = briefkasten().filter((e) => !angekommen.has(String(e.text).trim()));
    if (rest.length !== briefkasten().length) briefkastenSpeichern(rest);
  }

  /** Ungelesene Antworten am Chat-Knopf (Handy, Chat eingeklappt) */
  function ungelesenZeigen() {
    const z = $('#chatZaehler');
    if (!z) return;
    z.hidden = !j.ungelesen;
    z.textContent = j.ungelesen > 9 ? '9+' : String(j.ungelesen || '');
  }

  // ---------- Darstellung ----------
  function lokal(von, text, laut) {
    j.lokal.push({ id: 'l' + Date.now() + Math.random(), von, text, zeit: new Date().toISOString(), lokal: true });
    if (laut && von === 'jarvis') sprechen(text);
    chatZeichnen();
  }

  function vorschlag(id) { return j.zustand && j.zustand.vorschlaege.find((v) => v.id === id); }

  function schrittHtml(s) {
    if (s.typ === 'agent') {
      const team = s.unterMax ? `<br><span class="leise">${s.leitung ? 'Plant und verteilt' : 'Plant mit seinem Team'}: höchstens ${s.unterMax} von ${(s.teamNamen || []).length} – ${esc((s.teamNamen || []).slice(0, 8).join(', '))}${(s.teamNamen || []).length > 8 ? ' …' : ''}</span>` : '';
      return `<li><b>${esc(s.name)}</b> <span class="leise">(${esc(s.bereich)} · ${s.rechte === 'web' ? 'mit Websuche' : 'nur Text'} · max. ${s.hoechstMin} Min.)</span>${team}<br><span class="leise">${esc(s.briefing.slice(0, 220))}${s.briefing.length > 220 ? ' …' : ''}</span></li>`;
    }
    if (s.typ === 'katalog') {
      return `<li><b>${esc(s.beschreibung)}</b><br><span class="leise">${s.agenten.slice(0, 12).map((a) => esc(a.name) + ' (' + esc(a.bereichName) + ')').join(', ')}${s.agenten.length > 12 ? ' …' : ''}</span></li>`;
    }
    if (s.typ === 'sitzung') {
      return `<li><b>${esc(s.titel)}</b> – ${esc(s.ziel)}<br><span class="leise">Ordner ${esc(s.ordner)} · ${s.rechte === 'lesen' ? 'nur lesen' : 'Dateien bearbeiten (Befehle nur aus fester Liste, kein Push)'} · höchstens ${s.hoechstMin} Min.</span></li>`;
    }
    if (s.schluessel === 'mails.entwurf' && s.daten) {
      return `<li><b>Mail-Entwurf speichern – wird nicht versendet</b><br><span class="leise">An:</span> ${esc(s.daten.an)}<br><span class="leise">Betreff:</span> ${esc(s.daten.betreff || '(ohne Betreff)')}${s.daten.antwortAufId ? ' <span class="leise">(Antwort im selben Verlauf)</span>' : ''}<p class="text-block">${esc(s.daten.text)}</p></li>`;
    }
    return `<li><b>${esc(s.beschreibung)}</b></li>`;
  }

  const STATUS_TEXT = { offen: 'Wartet auf Ihre Freigabe', zurueckgestellt: 'Zurückgestellt – nicht gestartet', freigegeben: 'Freigegeben', verworfen: 'Verworfen' };

  function vorschlagHtml(v) {
    if (!v) return '';
    const aktiv = v.status === 'offen' || v.status === 'zurueckgestellt';
    return `<div class="freigabe ${aktiv ? '' : 'erledigt'}" data-vorschlag="${esc(v.id)}">
      <p class="oberzeile">Freigabe · ${STATUS_TEXT[v.status] || esc(v.status)}</p>
      <h3>${esc(v.titel)}</h3>
      ${v.begruendung ? `<p class="leise" style="margin:0">${esc(v.begruendung)}</p>` : ''}
      ${v.ablaufName ? `<p class="leise" style="margin:6px 0 0">Ablauf aus dem Katalog: <b>${esc(v.ablaufName)}</b></p>` : ''}
      ${v.schritte.some((s) => s.typ === 'agent') && v.schritte.filter((s) => s.typ === 'agent').length > 1 ? `<p class="leise" style="margin:6px 0 0">Reihenfolge: ${v.ablauf === 'kette' ? 'nacheinander, jeder baut auf dem vorherigen auf' : 'parallel'}</p>` : ''}
      ${v.schritte.some((s) => s.typ === 'agent') ? `<p class="leise" style="margin:6px 0 0">Modus: <b>${v.modus === 'gruendlich' ? 'gründlich' : 'schnell'}</b> – ${v.modus === 'gruendlich' ? 'ausführliche Ergebnisse, stärkstes Modell, dauert deutlich länger' : 'kompakte Ergebnisse in wenigen Minuten' + (v.ablauf === 'kette' && v.schritte.filter((s) => s.typ === 'agent').length > 2 ? ', Schritt 1 zuerst, danach parallel' : '')}</p>` : ''}
      ${v.pruefen ? `<p class="leise" style="margin:6px 0 0">Zum Schluss: Qualitätsprüfung, bei Mängeln eine Überarbeitung · höchstens ${v.laeufe} Läufe insgesamt</p>` : ''}
      <ol>${v.schritte.map(schrittHtml).join('')}</ol>
      ${aktiv ? `<div class="knopf-reihe" style="margin-top:8px">
        ${v.status === 'zurueckgestellt' ? `<button class="knopf klein" data-j="verwerfen" data-id="${esc(v.id)}">Verwerfen</button>` : `<button class="knopf klein" data-j="ablehnen" data-id="${esc(v.id)}">Ablehnen</button>`}
        <button class="knopf klein haupt-knopf" data-j="freigeben" data-id="${esc(v.id)}">Freigeben</button></div>` : ''}
    </div>`;
  }

  /** Knappe Statuszeile je Aktion unter MOs Antwort (z. B. „✓ Termin angelegt“, „✗ Fehler: …“). */
  const AKTION_ZEICHEN = { ok: '✓', fehler: '✗', wartet: '⏳', abgelehnt: '–' };
  function aktionenHtml(m) {
    if (!Array.isArray(m.aktionen) || !m.aktionen.length) return '';
    return `<span class="leise" style="display:block;margin-top:6px;font-size:.8rem">${m.aktionen.map((a) =>
      `<span style="display:block"${a.status === 'fehler' ? ' class="fehlertext"' : ''}>${AKTION_ZEICHEN[a.status] || '·'} ${esc(a.text)}</span>`).join('')}</span>`;
  }

  function chatZeichnen() {
    const server = (j.zustand && j.zustand.chat) || [];
    briefkastenAbgleichen();
    const wartend = briefkasten().map((e) => ({ id: 'bk' + e.id, von: 'nutzer', text: e.text, zeit: e.zeit, imBriefkasten: true }));
    const alle = server.concat(j.lokal, wartend).sort((a, b) => a.zeit.localeCompare(b.zeit)).slice(-80);
    const unten = verlaufEl.scrollHeight - verlaufEl.scrollTop - verlaufEl.clientHeight < 80;
    let h = '';
    for (const m of alle) {
      const zeit = new Date(m.zeit).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const hinweis = m.imBriefkasten ? '<span class="briefkasten-hinweis">⏳ im Briefkasten – MO bearbeitet das, sobald die Zentrale läuft</span>'
        : m.nachgereicht ? `<span class="briefkasten-hinweis">✉ unterwegs geschrieben um ${esc(new Date(m.nachgereicht).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))}</span>` : '';
      h += `<div class="nachricht ${m.von}${m.imBriefkasten ? ' wartend' : ''}">${hinweis}${esc(m.text)}${m.prompt ? `<div class="prompt-block"><div class="prompt-kopf"><span>Prompt</span><button class="knopf klein" data-j="prompt-kopieren" data-id="${esc(m.id)}">Kopieren</button></div><pre>${esc(m.prompt)}</pre></div>` : ''}${Array.isArray(m.orte) && m.orte.length ? `<button class="knopf klein erde-knopf" data-j="erde-zeigen" data-id="${esc(m.id)}">🌍 Auf der Erde zeigen</button>` : ''}${aktionenHtml(m)}<span class="zeit">${zeit}</span></div>`;
      if (m.vorschlagId) h += vorschlagHtml(vorschlag(m.vorschlagId));
    }
    if (j.teil) h += `<div class="nachricht jarvis live">${esc(j.teil)}<span class="cursor"></span></div>`;
    else if (j.zustand && j.zustand.jarvis && j.zustand.jarvis.status === 'denkt') h += '<div class="denkt nachricht jarvis"><i></i><i></i><i></i></div>';
    verlaufEl.innerHTML = h || '<p class="leise" style="text-align:center;margin:auto">Sprechen oder schreiben Sie mir. Ich kümmere mich um den Rest.</p>';
    if (unten || j.ersteRunde) verlaufEl.scrollTop = verlaufEl.scrollHeight;
    j.ersteRunde = false;
  }

  function allesZeichnen() {
    const z = j.zustand;
    if (z) agentenStand = { agenten: z.agenten, jarvis: z.jarvis };
    const offen = z ? z.vorschlaege.filter((v) => v.status === 'offen').length : 0;
    const zaehler = $('#zaehlerFreigaben');
    zaehler.hidden = !offen; zaehler.textContent = offen;
    chatZeichnen();
    wolkeAktualisieren();
    document.dispatchEvent(new CustomEvent('studio:daten')); // Seitenanzeigen auffrischen
    if (Studio.z.ansicht === 'sitzungen' && arbeit.reiter !== 'bibliothek' && arbeit.reiter !== 'agenten') Studio.zeichnen();
  }

  function wolkeAktualisieren() {
    // Katalog immer laden – auch wenn die Wolke (Modul) noch nicht fertig ist; sie holt ihn sich beim Start ab
    katalogLaden();
    if (!window.Wolke) return;
    // Selbstheilung: Hat die Wolke den Katalog verpasst (z. B. weil sie später geladen wurde), jetzt nachreichen
    if (j.katalog && Wolke.setzeKatalog && Wolke.bereiche === 0) Wolke.setzeKatalog(j.katalog);
    window.Wolke.setzeAgenten(agentenStand.agenten, agentenStand.jarvis);
    if (Wolke.setzeAktive) Wolke.setzeAktive((j.zustand && j.zustand.aktiveAgenten) || {});
  }

  // ---------- Arbeit (Schublade): Aufträge · Bibliothek · Agenten · Meldungen ----------
  const SITZUNG_STATUS = { bereit: ['wartet auf Bau-Befehl', 'warn'], frage: ['Rückfrage', 'warn'], unklar: ['Abschluss unklar', 'warn'], angehalten: ['angehalten', 'warn'], laeuft: ['läuft', 'gruen'], wartet: ['wartet auf Platz', 'warn'], fertig: ['fertig', 'ok'], fehler: ['Fehler', 'rot'], gestoppt: ['gestoppt', ''], abgebrochen: ['abgebrochen', 'warn'], teilweise: ['teilweise fertig', 'warn'], prueft: ['wird geprüft', 'gruen'], ueberarbeitet: ['wird überarbeitet', 'warn'], geplant: ['geplant', ''], arbeitet: ['arbeitet', 'gruen'] };
  const PRUEFUNG = { laeuft: 'läuft', bestanden: 'bestanden', ueberarbeitet: 'Mängel gefunden, überarbeitet', fehler: 'nicht möglich' };
  const PHASE = { bau: 'baut', antwort: 'arbeitet mit Antwort', anstoss: 'angestoßen', fortsetzen: 'setzt fort', korrektur: 'korrigiert', test: 'wird getestet' };
  const stoppbar = (s) => s.art === 'bau' ? !['fertig', 'gestoppt'].includes(s.status) : ['laeuft', 'wartet'].includes(s.status);
  const arbeit = { reiter: 'auftraege', bib: null, bibSuche: '', agentSuche: '', offen: new Set() };

  async function katalogLaden() {
    // Ohne Zentrale: mitgelieferten Katalog zeigen, damit die Wolke nie leer ist (eigene Agenten kommen mit der Verbindung dazu)
    if (!j.zustand) {
      if (!j.katalog && window.DEMO_KATALOG) {
        j.katalog = window.DEMO_KATALOG;
        if (window.Wolke && Wolke.setzeKatalog) Wolke.setzeKatalog(j.katalog);
      }
      return;
    }
    if (j.katalog && j.katalog.version === j.zustand.katalogVersion) return;
    try {
      j.katalog = await zentrale('GET', '/api/katalog');
      if (window.Wolke && Wolke.setzeKatalog) Wolke.setzeKatalog(j.katalog);
      if (Studio.z.ansicht === 'sitzungen') Studio.zeichnen();
    } catch (e) { /* später erneut */ }
  }

  function reiterHtml() {
    const r = [['auftraege', 'Aufträge'], ['bibliothek', 'Bibliothek'], ['agenten', 'Agenten'], ['meldungen', 'Meldungen']];
    return `<div class="reiter">${r.map(([id, t]) => `<button class="${arbeit.reiter === id ? 'aktiv' : ''}" data-j="reiter" data-id="${id}">${t}</button>`).join('')}</div>`;
  }

  function auftraegeHtml(z) {
    let h = '';
    const offen = z.vorschlaege.filter((v) => v.status === 'offen' || v.status === 'zurueckgestellt').reverse();
    if (offen.length) h += '<p class="gruppe-titel">Warten auf Ihre Freigabe</p>' + offen.map(vorschlagHtml).join('<div style="height:8px"></div>');
    const auftraege = (z.auftraege || []).slice().reverse();
    h += '<p class="gruppe-titel">Aufträge an Fach-Agenten</p>';
    if (!auftraege.length) h += '<p class="leise">Noch keine. Sagen Sie MO etwa: „Plane die Werbung für das nächste PLUGGED-Event.“</p>';
    else h += '<ul class="liste">' + auftraege.map((a) => {
      const [txt, kl] = SITZUNG_STATUS[a.status] || [a.status, ''];
      return `<li style="flex-direction:column;gap:6px">
        <span class="titel"><b>${esc(a.titel)}</b></span>
        <span class="chips"><span class="chip ${kl}">${txt}</span>${a.ablaufName ? `<span class="chip">${esc(a.ablaufName)}</span>` : ''}${a.modus === 'gruendlich' ? '<span class="chip">gründlich</span>' : ''}<span class="chip">${a.ablauf === 'kette' ? 'nacheinander' : 'parallel'}</span><span class="chip">${a.schritte.length} Agent${a.schritte.length === 1 ? '' : 'en'}</span></span>
        <span class="team-schritte">${a.schritte.map((s) => {
          const [st, sk] = SITZUNG_STATUS[s.status] || [s.status, ''];
          const unter = (s.unter || []).length ? `<span class="team-unter">${s.unter.map((u) => { const [ut, uk] = SITZUNG_STATUS[u.status] || [u.status, '']; return `<span><span class="chip ${uk}">${ut}</span> ${esc(u.name)}${u.ergebnisId ? ` <button class="knopf klein" data-j="bib-oeffnen" data-id="${esc(u.ergebnisId)}">Teil</button>` : ''}</span>`; }).join('')}</span>` : '';
          return `<span class="team-schritt"><span class="chip ${sk}">${st}</span> ${esc(s.name)}${s.ueberarbeitet ? ' <span class="chip">überarbeitet</span>' : ''}${s.ergebnisId ? ` <button class="knopf klein" data-j="bib-oeffnen" data-id="${esc(s.ergebnisId)}">Ergebnis</button>` : ''}${s.fehler ? `<small class="fehlertext">${esc(s.fehler)}</small>` : ''}${unter}</span>`;
        }).join('')}</span>
        ${a.pruefung ? `<span class="leise"><b>Qualitätsprüfung:</b> ${esc(PRUEFUNG[a.pruefung.status] || a.pruefung.status)}${a.pruefung.text ? ' – ' + esc(a.pruefung.text) : ''}${a.pruefung.ergebnisId ? ` <button class="knopf klein" data-j="bib-oeffnen" data-id="${esc(a.pruefung.ergebnisId)}">Prüfbericht</button>` : ''}</span>` : ''}
      </li>`;
    }).join('') + '</ul>';
    h += `<p class="gruppe-titel">Claude-Code-Sitzungen · Ordner: ${z.ordner.length ? z.ordner.map(esc).join(', ') : 'keine freigeschaltet'}</p>`;
    if (!z.sitzungen.length) return h + '<p class="leise">Keine.</p>';
    h += '<ul class="liste">' + z.sitzungen.slice().reverse().map((s) => {
      const [txt, kl] = SITZUNG_STATUS[s.status] || [s.status, ''];
      return `<li class="sitzung" style="flex-direction:column;gap:4px">
        <span class="titel"><b>${esc(s.titel)}</b></span>
        <span class="chips"><span class="chip ${kl}">${txt}${s.haengt ? ' · hängt?' : ''}</span>${s.art === 'bau' && s.phase && s.status === 'laeuft' ? `<span class="chip">${esc(PHASE[s.phase] || s.phase)}</span>` : ''}<span class="chip">${esc(s.ordner)}</span><span class="chip">${s.rechte === 'lesen' ? 'nur lesen' : s.rechte === 'bauen' ? 'bauen + Pakete' : 'bearbeiten'}</span><span class="chip">max. ${s.hoechstMin} Min.${s.art === 'bau' ? ' je Lauf' : ''}</span></span>
        <span class="leise">${esc(s.art === 'bau' && s.pfad ? s.pfad : s.ziel)}</span>
        ${s.frage ? `<span class="leise"><b>Rückfrage:</b> ${esc(s.frage)}</span>` : ''}
        ${s.fehler ? `<span class="fehlertext">${esc(s.fehler)}</span>` : ''}
        <div class="zeilen">${esc(s.letzteZeilen.join('\n')) || '…'}</div>
        <span class="zeile-knoepfe" style="margin-top:6px"><button class="knopf klein" data-j="details" data-id="${esc(s.id)}">Protokoll</button>
          ${stoppbar(s) ? `<button class="knopf klein gefahr" data-j="stoppen" data-id="${esc(s.id)}">${s.art === 'bau' ? 'Abbrechen' : 'Stoppen'}</button>` : ''}</span>
      </li>`;
    }).join('') + '</ul>';
    return h;
  }

  async function bibliothekLaden() {
    try { arbeit.bib = await zentrale('GET', '/api/bibliothek?q=' + encodeURIComponent(arbeit.bibSuche)); }
    catch (e) { arbeit.bib = []; toast(e.message); }
    if (Studio.z.ansicht === 'sitzungen' && arbeit.reiter === 'bibliothek') listeErneuern();
  }

  function bibliothekListe() {
    if (!arbeit.bib) { bibliothekLaden(); return '<p class="laden">Lade Bibliothek …</p>'; }
    if (!arbeit.bib.length) return `<p class="leer">${arbeit.bibSuche ? 'Nichts gefunden.' : 'Noch leer. Ergebnisse Ihrer Fach-Agenten landen hier.'}</p>`;
    return '<ul class="liste">' + arbeit.bib.map((e) => `<li style="flex-direction:column;gap:4px">
      <button class="haupt" data-j="bib-oeffnen" data-id="${esc(e.id)}"><span class="titel"><b>${esc(e.titel)}</b></span>
      <span class="chips"><span class="chip">${esc(e.bereich)}</span><span class="chip">${esc(new Date(e.zeit).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></span>
      <span class="leise">${esc(e.auszug)}…</span></button></li>`).join('') + '</ul>';
  }

  function agentenListe() {
    if (!j.katalog) { katalogLaden(); return '<p class="laden">Lade Katalog …</p>'; }
    const s = arbeit.agentSuche.toLowerCase();
    let gesamt = 0, h = '';
    for (const b of j.katalog.bereiche) {
      const passt = (a) => `${a.name} ${a.aufgabe} ${b.name}`.toLowerCase().includes(s);
      const treffer = b.agenten.filter((a) => !s || passt(a) || (a.unter || []).some(passt));
      gesamt += b.agenten.length + b.agenten.reduce((n, a) => n + (a.unter || []).length, 0);
      if (!treffer.length) continue;
      const auf = s || arbeit.offen.has(b.id);
      const aktiv = (j.zustand && j.zustand.aktiveAgenten) || {};
      h += `<div class="bereich"><button class="bereich-kopf" data-j="bereich" data-id="${esc(b.id)}"><span>${esc(b.name)}</span><small>${treffer.length} · ${esc(b.gruppe)}</small><span>${auf ? '▾' : '▸'}</span></button>`;
      if (auf) h += '<ul class="liste">' + treffer.map((a) => `<li style="flex-direction:column;gap:4px">
        <span class="titel"><b>${esc(a.name)}</b>${a.leitung ? ' <span class="chip">Leitung</span>' : ''}${a.rechte === 'web' ? ' <span class="chip">Websuche</span>' : ''}${a.eigen ? ' <span class="chip">eigen</span>' : ''}${aktiv[a.id] ? ` <span class="chip gruen">${esc(aktiv[a.id])}</span>` : ''}</span>
        <span class="leise">${esc(a.aufgabe)} → ${esc(a.liefert)}</span>
        ${(a.unter || []).length ? `<span class="unter-liste">${a.unter.filter((u) => !s || passt(u) || passt(a)).map((u) => `<button class="unter-agent" data-j="unter-zeigen" data-id="${esc(u.id)}" title="${esc(u.aufgabe)}">${esc(u.name)}${aktiv[u.id] ? ' ●' : ''}</button>`).join('')}</span>` : ''}
        <span class="zeile-knoepfe"><button class="knopf klein" data-j="agent-beauftragen" data-id="${esc(a.id)}">Beauftragen …</button><button class="knopf klein" data-j="agent-zeigen" data-id="${esc(a.id)}">In der Wolke zeigen</button></span>
      </li>`).join('') + '</ul>';
      h += '</div>';
    }
    return `<p class="leise">${gesamt} Fach-Agenten in ${j.katalog.bereiche.length} Bereichen${(j.katalog.ablaeufe || []).length ? `, ${j.katalog.ablaeufe.length} feste Abläufe` : ''}. Spezialisten planen mit ihren Unteragenten. Neue erschafft MO auf Zuruf („Erstelle mir einen Agenten für …“).</p>` + (h || '<p class="leer">Kein Agent gefunden – MO kann ihn für Sie anlegen.</p>');
  }

  function meldungenHtml(z) {
    const n = z.ntfy || {};
    return `${window.Push ? Push.karteHtml(z) : ''}<div class="karte">
      <h3>Push-Meldungen aufs Handy (ntfy)</h3>
      <p class="leise">Wenn das Studio geschlossen ist, meldet sich MO kurz und neutral: „Eine Freigabe wartet“, „Ergebnisse sind fertig“, „Ein Termin beginnt in Kürze“ – ohne Inhalte.</p>
      <ol class="schritte-liste">
        <li>App <b>ntfy</b> installieren (Android: Play Store, iPhone/iPad: App Store). Kostenlos, kein Konto nötig.</li>
        <li>In der App auf <b>＋</b> tippen und diesen Kanal abonnieren:<br><code class="kanal">${esc(n.kanal || '…')}</code> <button class="knopf klein" data-j="kanal-kopieren">Kopieren</button></li>
        <li>Hier einschalten – MO schickt sofort eine Testmeldung.</li>
      </ol>
      <div class="knopf-reihe">${n.an
        ? '<span class="chip ok">eingeschaltet</span><button class="knopf klein" data-j="ntfy" data-id="aus">Ausschalten</button>'
        : '<button class="knopf haupt-knopf" data-j="ntfy" data-id="an">Einschalten</button>'}</div>
      <p class="hilfe">Der Kanalname ist Ihr Schlüssel – wer ihn kennt, sieht die (inhaltslosen) Meldungen. Meldungen laufen über den öffentlichen ntfy-Server.</p>
    </div>
    <div class="karte">
      <h3>Zentrale neu starten</h3>
      <p class="leise">Prüft zuerst alle Programmdateien der Zentrale. Nur wenn alle fehlerfrei sind, wird der Stand gesichert und die Zentrale neu gestartet; die App verbindet sich danach von selbst wieder.</p>
      <div class="knopf-reihe"><button class="knopf" data-j="neustart">Zentrale neu starten</button></div>
    </div>`;
  }

  async function zentraleNeustarten() {
    if (!j.verbunden) return toast('Die Zentrale ist nicht erreichbar.');
    if (!(await Studio.bestaetigen('Zentrale neu starten?', 'Die Zentrale prüft ihren Code und startet dann neu. Für einige Sekunden ist sie nicht erreichbar.', 'Neu starten', true))) return;
    try {
      let r = await zentrale('POST', '/api/neustart', {});
      if (!r.neustart && r.laufend && !r.fehler.length) {
        if (!(await Studio.bestaetigen('Sitzungen laufen noch', `${r.laufend} Claude-Sitzung(en) laufen gerade und werden durch den Neustart abgebrochen. Trotzdem neu starten?`, 'Trotzdem', true))) return;
        r = await zentrale('POST', '/api/neustart', { trotzdem: true });
      }
      if (r.fehler.length) {
        return Studio.dialogOeffnen(`<h2>Kein Neustart</h2><p class="leise">Diese Dateien enthalten Fehler – die Zentrale läuft unverändert weiter.</p>
          <div style="font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;background:rgba(0,0,0,.3);padding:10px;border-radius:10px;max-height:300px;overflow:auto">${r.fehler.map((f) => esc(f.datei + '\n' + f.fehler)).join('\n\n')}</div>
          <div class="knopf-reihe"><button class="knopf" value="ok">Schließen</button></div>`);
      }
      toast('Code geprüft – die Zentrale startet neu. Ich verbinde mich gleich wieder.', 8000);
      setTimeout(() => verbinden(), 9000); // start-zentrale.cmd wartet 5 s vor dem Neustart
    } catch (err) { toast(err.message, 6000); }
  }

  function sitzungenZeichnen() {
    if (!zentraleBereit()) return '<p class="leer">Die Zentrale ist noch nicht eingerichtet. Tragen Sie Adresse und Kopplungsschlüssel in den Einstellungen (⚙) ein.</p>';
    if (!j.verbunden || !j.zustand) return '<p class="leer">Die Zentrale ist gerade nicht erreichbar. Aufträge lassen sich erst wieder steuern, wenn der Laptop antwortet.</p>';
    const z = j.zustand;
    let h = reiterHtml();
    if (arbeit.reiter === 'auftraege') h += auftraegeHtml(z);
    if (arbeit.reiter === 'bibliothek') h += `<input class="suche" id="bibSuche" type="search" placeholder="Bibliothek durchsuchen …" value="${esc(arbeit.bibSuche)}"><div id="arbeitListe">${bibliothekListe()}</div>`;
    if (arbeit.reiter === 'agenten') h += `<input class="suche" id="agentSuche" type="search" placeholder="Agenten suchen (z. B. Instagram, Sponsoren, Preise) …" value="${esc(arbeit.agentSuche)}"><div id="arbeitListe">${agentenListe()}</div>`;
    if (arbeit.reiter === 'meldungen') h += meldungenHtml(z);
    return h;
  }

  function listeErneuern() {
    const el = document.getElementById('arbeitListe');
    if (!el) return Studio.zeichnen();
    el.innerHTML = arbeit.reiter === 'bibliothek' ? bibliothekListe() : agentenListe();
  }

  let suchTimer = null;
  $('#inhalt').addEventListener('input', (ev) => {
    if (ev.target.id === 'bibSuche') { arbeit.bibSuche = ev.target.value; clearTimeout(suchTimer); suchTimer = setTimeout(() => { arbeit.bib = null; listeErneuern(); }, 300); }
    if (ev.target.id === 'agentSuche') { arbeit.agentSuche = ev.target.value; listeErneuern(); }
  });

  async function bibOeffnen(id) {
    try {
      const e = await zentrale('GET', '/api/bibliothek/eintrag?id=' + encodeURIComponent(id));
      const r = await Studio.dialogOeffnen(`<h2>${esc(e.titel)}</h2>
        <p class="leise">${esc(e.bereich)} · ${esc(new Date(e.zeit).toLocaleString('de-DE'))}</p>
        <div class="ergebnis-text">${esc(e.inhalt)}</div>
        <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start">
          <button class="knopf haupt-knopf" value="kopieren">Kopieren</button>
          <button class="knopf" value="aufgabe">Als Aufgabe</button>
          <button class="knopf" value="zu" formnovalidate>Schließen</button></div>`);
      if (r.wert === 'kopieren') { try { await navigator.clipboard.writeText(e.inhalt); toast('In die Zwischenablage kopiert.'); } catch (err) { toast('Kopieren nicht möglich – bitte markieren und kopieren.'); } }
      if (r.wert === 'aufgabe') {
        try { await Studio.api('aufgabe.neu', { titel: 'Umsetzen: ' + e.titel.slice(0, 80), notizen: e.auszug, dauer: 30 }); toast('Als Aufgabe notiert.'); Studio.heuteLaden(true); }
        catch (err) { toast(err.message); }
      }
    } catch (err) { toast(err.message, 6000); }
  }

  Studio.ansichtRegistrieren('sitzungen', { zeichnen: sitzungenZeichnen, klick: () => {} });

  function agentZuKarte(id) {
    if (!j.katalog) return null;
    const status = ((j.zustand && j.zustand.aktiveAgenten) || {})[id] || 'bereit';
    for (const b of j.katalog.bereiche) {
      const a = b.agenten.find((x) => x.id === id);
      if (a) return { ...a, bereichName: b.name, art: 'fach', status };
      for (const sp of b.agenten) {
        const u = (sp.unter || []).find((x) => x.id === id);
        if (u) return { ...u, bereichName: b.name, art: 'fach', unteragent: true, elternName: sp.name, elternId: sp.id, status };
      }
    }
    return null;
  }

  async function entscheiden(id, entscheidung) {
    const v = vorschlag(id);
    if (!v) return toast('Vorschlag nicht gefunden.');
    if (!j.verbunden) return toast('Die Zentrale ist nicht erreichbar – Freigaben sind gerade nicht möglich.');
    try {
      await zentrale('POST', '/api/freigabe', { id, pruefsumme: v.pruefsumme, entscheidung });
      zustandAuffrischen();
    } catch (err) { toast(err.message, 6000); }
  }

  async function sitzungStoppen(id) {
    const s = j.zustand && j.zustand.sitzungen.find((x) => x.id === id);
    if (!s) return;
    if (!(await Studio.bestaetigen('Sitzung stoppen?', `„${esc(s.titel)}“ wird sofort beendet. Bereits vorgenommene Änderungen bleiben bestehen.`, 'Stoppen', true))) return;
    try { await zentrale('POST', '/api/sitzung/stopp', { id }); zustandAuffrischen(); toast('Sitzung gestoppt.'); } catch (err) { toast(err.message, 6000); }
  }

  async function sitzungDetails(id) {
    try {
      const s = await zentrale('GET', '/api/sitzung?id=' + encodeURIComponent(id));
      await Studio.dialogOeffnen(`<h2>${esc(s.titel)}</h2>
        <p class="leise">${esc(s.ziel)}</p>
        <p class="abschnitt">Auftrag</p><div class="zeilen" style="font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;background:rgba(0,0,0,.3);padding:10px;border-radius:10px;max-height:140px;overflow:auto">${esc(s.auftrag)}</div>
        <p class="abschnitt">Protokoll</p><div style="font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;background:rgba(0,0,0,.3);padding:10px;border-radius:10px;max-height:260px;overflow:auto">${esc(s.ausgabe.join('\n'))}</div>
        ${s.ergebnis ? `<p class="abschnitt">Ergebnis</p><p class="text-block">${esc(s.ergebnis)}</p>` : ''}
        <div class="knopf-reihe"><button class="knopf" value="ok">Schließen</button></div>`);
    } catch (err) { toast(err.message, 6000); }
  }

  function jKlick(ev) {
    const el = ev.target.closest('[data-j]');
    if (!el) return;
    ev.stopPropagation();
    const { j: was, id } = el.dataset;
    if (was === 'freigeben') entscheiden(id, 'ja');
    if (was === 'ablehnen') entscheiden(id, 'nein');
    if (was === 'verwerfen') entscheiden(id, 'verwerfen');
    if (was === 'stoppen') sitzungStoppen(id);
    if (was === 'details') sitzungDetails(id);
    if (was === 'prompt-kopieren') {
      const m = ((j.zustand && j.zustand.chat) || []).find((x) => x.id === id);
      if (m && m.prompt) navigator.clipboard.writeText(m.prompt).then(() => toast('Prompt kopiert.'), () => toast('Kopieren nicht möglich – bitte markieren.'));
    }
    if (was === 'erde-zeigen') {
      const m = ((j.zustand && j.zustand.chat) || []).find((x) => x.id === id);
      if (m && m.orte && window.Wolke && Wolke.globus) { Wolke.globus(m.orte); if (innerWidth <= 860) chatUmschalten(false); }
    }
    if (was === 'reiter') { arbeit.reiter = id; if (id === 'bibliothek') arbeit.bib = null; Studio.zeichnen(); }
    if (was === 'bereich') { arbeit.offen.has(id) ? arbeit.offen.delete(id) : arbeit.offen.add(id); listeErneuern(); }
    if (was === 'bib-oeffnen') bibOeffnen(id);
    if (was === 'agent-beauftragen') {
      const a = agentZuKarte(id);
      Studio.oeffne('jarvis');
      eingabe.value = `Beauftrage bitte den ${a ? a.name : id}: `;
      eingabe.focus();
      $('#agentKarte').hidden = true;
    }
    if (was === 'unter-zeigen') { const a = agentZuKarte(id); if (a) { const r = el.getBoundingClientRect(); agentKarte(a, r.left, r.top); } }
    if (was === 'agent-zeigen') { Studio.oeffne('jarvis'); if (window.Wolke && Wolke.fokus) Wolke.fokus(id); }
    if (was === 'kanal-kopieren') { const k = j.zustand && j.zustand.ntfy && j.zustand.ntfy.kanal; if (k) navigator.clipboard.writeText(k).then(() => toast('Kanalname kopiert.'), () => toast(k)); }
    if (was === 'neustart') zentraleNeustarten();
    if (was === 'ntfy') {
      zentrale('POST', '/api/einstellung', { ntfy: id === 'an' }).then((r) => { j.zustand.ntfy = r.ntfy; Studio.zeichnen(); toast(id === 'an' ? 'Eingeschaltet – eine Testmeldung ist unterwegs.' : 'Ausgeschaltet.'); }).catch((err) => toast(err.message));
    }
  }
  verlaufEl.addEventListener('click', jKlick);
  $('#inhalt').addEventListener('click', jKlick);
  $('#agentKarte').addEventListener('click', jKlick);

  // ---------- Senden ----------
  const JA = /^(ja|ja,? bitte|jawohl|freigeben|freigabe erteilt|einverstanden|genehmigt|weiter|ok|okay|passt|ok(ay)?,? (freigeben|los))[.!]?$/i;
  const NEIN = /^(nein|ablehnen|nicht starten|abbrechen)[.!]?$/i;

  /** „Zeig mir meine Aufgaben“, „Welche Termine habe ich?“, „Was steht heute an?“ → passende Ansicht öffnen. */
  // (?:^|…) statt \b, weil \b vor Umlauten wie „öffne“ nicht greift
  const ZEIGEN = /(?:^|[\s,.!?„])(zeig\w*|öffne\w*|oeffne\w*|anzeig\w*|aufmach\w*|welche|was (steht|habe ich|hab ich|ist)|wie sieht|liste\s+\w+\s+auf|gib mir|übersicht)(?![a-zäöüß])/i;
  function ansichtAufZuruf(text) {
    const t = String(text);
    if (ABSICHT.test(t)) return null; // „Erstelle eine Aufgabe …“ ist kein Anzeigewunsch
    const tag = /\b(was steht (heute|morgen)? ?an|mein(en)? tag|tagesplan|heute an)\b/i.test(t);
    if (!ZEIGEN.test(t) && !tag) return null;
    if (/\b(aufgaben|to-?dos?|todo-?liste)\b/i.test(t)) return 'aufgaben';
    if (/\b(termine?|kalender)\b/i.test(t)) return 'termine';
    if (/\b(ideen?)\b/i.test(t)) return 'ideen';
    if (/\b(mails?|e-?mails?|posteingang)\b/i.test(t)) return 'mails';
    if (tag || /\b(heute|tagesübersicht)\b/i.test(t)) return 'heute';
    return null;
  }

  async function senden(text) {
    text = String(text || '').trim();
    if (!text) return;
    const ansicht = ansichtAufZuruf(text);
    if (ansicht) Studio.oeffne(ansicht);
    // Erdkugel auf Zuruf („Zeig mir die Welt“) und zurück („Zurück zum Hauptmenü“)
    if (window.Wolke && Wolke.globus) {
      if (/(?:^|[\s,.!?„])(zeig|öffne)\w*\s[^.?!]{0,30}\b(welt|erde|erdkugel|globus|weltkarte|weltlage)\b/i.test(text)) Wolke.globus([]);
      else if (/zurück (zum hauptmenü|zur wolke)|schließ\w* (die |den )?(erde|erdkugel|karte|weltkarte|globus)/i.test(text)) Wolke.globusZu();
    }
    eingabe.value = '';
    eingabe.style.height = '46px';
    if (j.verbunden) {
      // Freigabe per Wort nur, wenn genau ein Vorschlag offen ist – sonst bitte die Karte nutzen
      const offen = j.zustand ? j.zustand.vorschlaege.filter((v) => v.status === 'offen') : [];
      // „Ja“ gilt nur als Freigabe, wenn MOs letzte Nachricht genau diesen Vorschlag vorgelegt hat – sonst antwortet es auf einen Impuls
      const letzte = j.zustand ? j.zustand.chat.filter((m) => m.von === 'jarvis').slice(-1)[0] : null;
      const zurKarte = letzte && letzte.vorschlagId && offen.some((v) => v.id === letzte.vorschlagId);
      if ((JA.test(text) || NEIN.test(text)) && offen.length && zurKarte) {
        if (offen.length > 1) { lokal('jarvis', 'Es warten mehrere Vorschläge. Bitte nutzen Sie die jeweilige Karte, damit keine Verwechslung entsteht.', true); return; }
        lokal('nutzer', text);
        return entscheiden(offen[0].id, JA.test(text) ? 'ja' : 'nein');
      }
      try {
        await zentrale('POST', '/api/nachricht', { text });
        statusSetzen('denkt …');
      } catch (err) {
        lokal('nutzer', text);
        lokal('jarvis', 'Die Nachricht hat die Zentrale nicht erreicht (' + err.message + ').', true);
      }
      return;
    }
    // Zentrale aus: Ausdrückliche Notizen gehen sofort ans Google-Skript.
    // Alles andere (Fragen, Aufträge, Prompts …) wartet im Google-Briefkasten, bis die Zentrale es abholt.
    if (!ABSICHT.test(text)) {
      if (!Studio.cfg.url || Studio.cfg.url === 'demo') {
        lokal('nutzer', text);
        lokal('jarvis', 'Die Zentrale ist nicht erreichbar, und ohne Google-Verbindung kann ich Ihre Nachricht auch nicht für später ablegen. Notieren kann ich trotzdem, sobald Google eingerichtet ist.', true);
        return;
      }
      try {
        const r = await Studio.api('claude.nachricht', { text });
        briefkastenMerken({ id: r.id, text, zeit: r.zeit || new Date().toISOString() });
        lokal('jarvis', 'Die Zentrale ist gerade nicht erreichbar. Ihre Nachricht liegt im Briefkasten – sobald Ihr Laptop wieder läuft, kümmere ich mich darum. Die Antwort erscheint dann hier.', true);
      } catch (err) {
        lokal('nutzer', text);
        lokal('jarvis', /Unbekannte Aktion/i.test(err.message)
          ? 'Der Briefkasten fehlt noch im Google-Skript – bitte das Skript aktualisieren (siehe Anleitung). Bis dahin kann ich Ihre Nachricht nicht für später ablegen.'
          : 'Weder die Zentrale noch der Briefkasten sind gerade erreichbar (' + err.message + '). Bitte versuchen Sie es gleich noch einmal.', true);
      }
      return;
    }
    lokal('nutzer', text);
    if (!Studio.cfg.url) { lokal('jarvis', 'Weder Zentrale noch Google sind eingerichtet. Ein Blick in die Einstellungen (⚙) würde helfen.', true); return; }
    try {
      const typ = /\bidee\b/i.test(text) ? 'idee' : /\b(termin|kalender)\b/i.test(text) ? 'termin' : 'aufgabe';
      const r = await Studio.schnellNotieren(befehlEntfernen(text), typ);
      lokal('jarvis', r + (zentraleBereit() ? ' (Die Zentrale ist offline – Claude-Aufgaben warten, bis sie wieder erreichbar ist.)' : ''), true);
    } catch (err) { lokal('jarvis', 'Das Notieren ist fehlgeschlagen: ' + err.message, true); }
  }

  $('#eingabe').addEventListener('submit', (ev) => { ev.preventDefault(); stimmeFreischalten(); senden(eingabe.value); });
  // Mehrzeilig (z. B. ein eingefügter Prompt): Enter sendet, Umschalt+Enter macht eine neue Zeile
  const hoeheAnpassen = () => { eingabe.style.height = '46px'; eingabe.style.height = Math.min(180, eingabe.scrollHeight + 2) + 'px'; };
  eingabe.addEventListener('input', hoeheAnpassen);
  eingabe.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); $('#eingabe').requestSubmit(); }
  });
  $('#typWahl').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-typ]');
    if (!b) return;
    j.typ = b.dataset.typ;
    document.querySelectorAll('#typWahl button').forEach((x) => x.classList.toggle('aktiv', x === b));
  });

  // ---------- Sprache ----------
  let stimme = null;
  /** Beste deutsche Stimme: zuerst die eigene Wahl, sonst natürliche (neuronale) Stimmen, dann die besseren Standardstimmen. */
  function deutscheStimmen() { return TTS ? TTS.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang)) : []; }
  function stimmeWaehlen() {
    if (!TTS) return null;
    const de = deutscheStimmen();
    const eigene = Studio.cfg.stimmeName && de.find((v) => v.name === Studio.cfg.stimmeName);
    if (eigene) return eigene;
    // „Online (Natural)“ = neuronale Microsoft-Stimmen (Edge, Windows-Sprachpakete), danach Google und Premium-Stimmen (iPhone)
    const rang = (v) => (/natural|neural/i.test(v.name) ? 0 : /premium|enhanced|erweitert/i.test(v.name) ? 1 : /google/i.test(v.name) ? 2 : 3);
    const maennlich = /conrad|killian|florian|ralf|bernd|christoph|kasper|klaus|markus|yannick|stefan|viktor|martin/i;
    return de.slice().sort((a, b) => rang(a) - rang(b) || (maennlich.test(b.name) ? 1 : 0) - (maennlich.test(a.name) ? 1 : 0))[0] || null;
  }
  function stimmeProbe(name) {
    if (!TTS) return;
    const v = deutscheStimmen().find((x) => x.name === name) || stimmeWaehlen();
    TTS.cancel();
    const u = new SpeechSynthesisUtterance('Guten Tag. Ich bin MO. Womit kann ich dienen?');
    u.lang = 'de-DE'; if (v) u.voice = v; u.rate = 1.02; u.pitch = 0.92;
    TTS.speak(u);
  }
  // Probe-Knopf im Einstellungsdialog
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-stimme-probe]');
    if (!b) return;
    ev.preventDefault();
    const sel = b.closest('form') && b.closest('form').querySelector('[name="stimmeName"]');
    stimmeProbe(sel ? sel.value : '');
  });
  if (TTS) { stimme = stimmeWaehlen(); TTS.onvoiceschanged = () => { stimme = stimmeWaehlen(); }; }

  let freigeschaltet = false;
  function stimmeFreischalten() {
    // iOS/iPadOS geben Sprachausgabe erst nach einer Berührung frei
    if (freigeschaltet || !TTS) return;
    freigeschaltet = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; TTS.speak(u); } catch (e) { /* egal */ }
    try { audioKontext = audioKontext || new (window.AudioContext || window.webkitAudioContext)(); audioKontext.resume(); } catch (e) { /* egal */ }
  }
  document.addEventListener('pointerdown', stimmeFreischalten, { once: true });

  // Sprachausgabe. Danach hört MO im Gesprächs-/Rufwort-Modus von selbst wieder zu.
  let sprichtGerade = false, sprechTimer = null;
  // ---------- MOs eigene Stimme über die Zentrale (Piper) – mit Rückfall auf die Browser-Stimme ----------
  const moAudio = new Audio();
  let audioKontext = null, analyse = null, pegelDaten = null, pegelLauf = 0;
  function zentraleStimmeNutzen() {
    return !!(j.verbunden && j.zustand && j.zustand.stimme && j.zustand.stimme.bereit && !Studio.cfg.stimmeName && Studio.cfg.zentrale !== 'demo');
  }
  /** Lautstärke der Stimme → Impulse am Kern der Wolke (echter Sprechrhythmus) */
  function pegelVerfolgen() {
    if (!analyse) {
      try {
        audioKontext = audioKontext || new (window.AudioContext || window.webkitAudioContext)();
        const quelle = audioKontext.createMediaElementSource(moAudio);
        analyse = audioKontext.createAnalyser(); analyse.fftSize = 512;
        quelle.connect(analyse); analyse.connect(audioKontext.destination);
        pegelDaten = new Uint8Array(analyse.fftSize);
      } catch (e) { return; }
    }
    if (audioKontext.state === 'suspended') audioKontext.resume();
    const lauf = ++pegelLauf;
    let vorher = 0, oben = false;
    const schritt = () => {
      if (lauf !== pegelLauf || moAudio.paused) return;
      analyse.getByteTimeDomainData(pegelDaten);
      let s = 0; for (let i = 0; i < pegelDaten.length; i++) { const x = (pegelDaten[i] - 128) / 128; s += x * x; }
      const rms = Math.sqrt(s / pegelDaten.length);
      // Silbe = Lautstärke steigt deutlich an
      if (!oben && rms > 0.06 && rms > vorher * 1.25) { oben = true; if (window.Wolke && Wolke.sprichtImpuls) Wolke.sprichtImpuls(); }
      if (oben && rms < 0.035) oben = false;
      vorher = rms * 0.6 + vorher * 0.4;
      requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  }
  async function stimmeHolen(text) {
    const res = await fetch(Studio.cfg.zentrale + '/api/stimme', {
      method: 'POST', headers: { Authorization: 'Bearer ' + Studio.cfg.zentraleSchluessel, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(20000)
    });
    if (!res.ok || !/audio/.test(res.headers.get('content-type') || '')) throw new Error('Stimme der Zentrale nicht verfügbar');
    return URL.createObjectURL(await res.blob());
  }
  /**
   * Satz für Satz: Der erste Satz erklingt, während die Zentrale die nächsten schon rechnet.
   * Gibt ein Promise zurück, das nach dem letzten Satz erfüllt ist (oder beim ersten Fehler scheitert).
   */
  let sprechLauf = 0;
  async function sprechenZentrale(text) {
    const lauf = ++sprechLauf;
    const saetze = String(text).match(/[^.!?…]+[.!?…]*\s*/g)?.map((x) => x.trim()).filter(Boolean) || [String(text)];
    // nur sehr kurze Sätze zusammenfassen
    const stuecke = [];
    for (const x of saetze) { if (stuecke.length > 1 && (stuecke[stuecke.length - 1] + ' ' + x).length < 45) stuecke[stuecke.length - 1] += ' ' + x; else stuecke.push(x); } // Satz für Satz: der nächste wird gerechnet, während der aktuelle läuft
    const urls = stuecke.map(() => null);
    let fertigGeholt = 0, fehler = null, weckeAuf = null;
    (async () => {
      for (let i = 0; i < stuecke.length && lauf === sprechLauf; i++) {
        try { urls[i] = await stimmeHolen(stuecke[i]); } catch (e) { fehler = e; }
        fertigGeholt = i + 1;
        if (weckeAuf) weckeAuf();
        if (fehler) break;
      }
    })();
    const warteAuf = (i) => new Promise((ok) => { const p = () => (fertigGeholt > i || fehler ? ok() : (weckeAuf = p)); p(); });
    for (let i = 0; i < stuecke.length; i++) {
      await warteAuf(i);
      if (lauf !== sprechLauf) return;
      if (!urls[i]) throw fehler || new Error('Stimme fehlt');
      if (moAudio.src) URL.revokeObjectURL(moAudio.src);
      moAudio.src = urls[i];
      window.dispatchEvent(new CustomEvent('mo:satz', { detail: stuecke[i] })); // Erdkugel dreht zum genannten Ort
      await moAudio.play();
      await new Promise((ok) => { moAudio.onended = ok; moAudio.onerror = ok; });
    }
  }
  moAudio.onplay = () => { if (window.Wolke) Wolke.setzeSpricht(true); pegelVerfolgen(); };

  function sprechen(text) {
    if (!text || !Studio.cfg.stimme) { gesprochen(); return; }
    if (zentraleStimmeNutzen()) {
      const satz = String(text).replace(/[„“”"*#_`]/g, '').slice(0, 2400);
      try { TTS && TTS.cancel(); } catch (e) { /* egal */ }
      moAudio.pause();
      hoerenPausieren(); // nicht sich selbst zuhören
      sprichtGerade = true;
      const fertig = () => {
        if (!sprichtGerade) return;
        sprichtGerade = false; pegelLauf++;
        if (window.Wolke) Wolke.setzeSpricht(false);
        gesprochen();
      };
      let angefangen = false;
      const meinLauf = sprechLauf + 1; // sprechenZentrale zählt gleich hoch
      moAudio.onplaying = () => { angefangen = true; };
      sprechenZentrale(satz).then(() => { if (meinLauf === sprechLauf) fertig(); }).catch((err) => {
        // Von einer neueren Ausgabe abgelöst (oder bewusst angehalten): still enden – nie doppelt sprechen
        if (meinLauf !== sprechLauf || (err && err.name === 'AbortError')) return;
        // Rückfall: Browser-Stimme nur, wenn von Thorsten noch nichts zu hören war
        if (angefangen) fertig(); else { sprichtGerade = false; browserSprechen(text); }
      });
      return;
    }
    browserSprechen(text);
  }

  function browserSprechen(text) {
    if (!text || !Studio.cfg.stimme || !TTS) { gesprochen(); return; }
    sprechLauf++; moAudio.pause(); // spricht der Browser, schweigt Thorsten – immer nur eine Stimme
    try {
      TTS.cancel();
      hoerenPausieren(); // nicht sich selbst zuhören
      const satz = String(text).replace(/[„“”"*#_`]/g, '').slice(0, 400);
      stimme = stimmeWaehlen(); // falls in den Einstellungen gewechselt
      const u = new SpeechSynthesisUtterance(satz);
      u.lang = 'de-DE'; if (stimme) u.voice = stimme;
      u.rate = 1.02; u.pitch = 0.92;
      sprichtGerade = true;
      const fertig = () => {
        if (!sprichtGerade) return;
        sprichtGerade = false; clearTimeout(sprechTimer);
        if (window.Wolke) Wolke.setzeSpricht(false);
        gesprochen();
      };
      u.onstart = () => { if (window.Wolke) Wolke.setzeSpricht(true); window.dispatchEvent(new CustomEvent('mo:satz', { detail: satz })); };
      u.onboundary = (ev) => { if (ev.name === 'word' && window.Wolke && Wolke.sprichtImpuls) Wolke.sprichtImpuls(); };
      u.onend = u.onerror = fertig;
      sprechTimer = setTimeout(fertig, 2500 + satz.length * 90); // Chrome meldet das Ende nicht immer
      TTS.speak(u);
    } catch (e) { sprichtGerade = false; gesprochen(); }
  }

  const knopfStimme = $('#knopfStimme');
  function stimmeKnopf() {
    knopfStimme.setAttribute('aria-pressed', String(!!Studio.cfg.stimme && !!TTS));
    knopfStimme.textContent = Studio.cfg.stimme && TTS ? '🔊' : '🔇';
  }
  knopfStimme.addEventListener('click', () => {
    if (!TTS) { lokal('jarvis', 'Sprachausgabe ist in diesem Browser nicht verfügbar. Ich antworte weiterhin schriftlich.'); return; }
    Studio.cfg.stimme = !Studio.cfg.stimme; Studio.einstellungenSpeichern(); stimmeKnopf();
    if (Studio.cfg.stimme) { stimmeFreischalten(); sprechen('Sprachausgabe aktiviert.'); } else { if (TTS) TTS.cancel(); sprechLauf++; moAudio.pause(); }
  });
  stimmeKnopf();

  // ---------- Zuhören: einmal · Gespräch · Rufwort „Hey MO“ ----------
  // modus: 'aus' | 'einmal' (ein Satz) | 'gespraech' (freihändig im Wechsel) | 'wach' (wartet auf „MO …“)
  const h = { modus: 'aus', sr: null, stille: 0, wartet: false, wartetTimer: null, befehl: false, ausloesen: null };
  // Ausdrücklicher Wunsch, etwas einzutragen (sonst wird nur geredet)
  const ABSICHT = /(\b(erstell|anleg|leg|trag|speicher|setz|plan|mach)\w*\b[^.?!]{0,40}\b(aufgabe|todo|to-do|termin|idee|notiz|erinnerung|kalender|liste)\b|\b(aufgabe|todo|to-do|termin|idee|notiz|erinnerung)\w*\b[^.?!]{0,30}\b(erstell|anleg|eintrag|notier|aufschreib|speicher|festhalt|anlegen|eintragen)\w*|\b(notier\w*|schreib\w*\s+(\w+\s+){0,3}auf|merk\w*\s+(dir|mir)|halt\w*\s+(\w+\s+)?fest|vergiss\s+nicht)\b|\berinner\w*\s+(mich|mir)\b|^(aufgabe|todo|to-do|termin|idee|notiz|erinnerung)\s*:)/i;
  /** „Erstelle eine Aufgabe: Brot kaufen“ → „Brot kaufen“ (Datum/Uhrzeit bleiben für die Erkennung erhalten) */
  function befehlEntfernen(t) {
    // „… Aufgabe erstellen: X“ / „Merke dir die Idee: X“ → X
    const doppel = /^.{0,70}?\b(aufgabe|todo|to-do|termin|idee|notiz|erinnerung)\b([^:]{0,30}):\s*(.+)$/i.exec(String(t).trim());
    if (doppel) {
      // Zeitangaben vor dem Doppelpunkt („für Freitag“, „morgen um 10“) behalten, Befehlswörter weglassen
      const zeit = doppel[2].replace(/\b(erstell|anleg|eintrag|notier|aufschreib|speicher|festhalt|bitte|an|ein|auf)\w*\b/gi, '').replace(/\s+/g, ' ').trim();
      return (doppel[3].trim() + (zeit ? ' ' + zeit : '')).trim();
    }
    const r = String(t).replace(/^\s*(bitte\s+)?(kannst du\s+(mir\s+)?)?(erstell\w*|leg\w*|trag\w*|notier\w*|schreib\w*|merk\w*|halt\w*|speicher\w*|setz\w*|plan\w*)\s+(mir|dir)?\s*(bitte\s+)?(eine?[nrs]?\s+)?(neue[nrs]?\s+)?(aufgabe|todo|to-do|termin|idee|notiz|erinnerung)?\s*(an|ein|auf|fest)?\s*(dass|:|,|-|–)?\s*/i, '')
      .replace(/^\s*(aufgabe|todo|to-do|termin|idee|notiz|erinnerung)\s*:\s*/i, '')
      .replace(/^\s*erinner\w*\s+(mich|mir)\s*(bitte\s+)?(daran,?\s*)?(dass\s+)?/i, '').replace(/^\s*dass\s+/i, '').trim();
    return r || String(t).trim();
  }
  const ENDE = /^(ende|stopp|stop|schluss|das wars?|das war's|danke,? das war'?s|gespräch beenden|tschüss|auf wiedersehen)[.!]?$/i;
  // Rufwort „Hey MO“ – die Spracherkennung schreibt es unterschiedlich (Mo, Moh, Moe, M. O., …)
  // Die Erkennung schreibt es oft zusammen („Heimo“, „Heymo“, „Haimo“) oder lässt das „Hey“ weg („Mo, …“ am Satzanfang)
  const RUF = /(?:\b(?:hey|hi|hei|ey|he|hallo|okay|ok)[,\s]*(?:mo|moh|moe|mow|moo|mö|m\.?\s?o\.?)|\b(?:heimo|heymo|haimo|hymo|heimoh|eimo|hailmo)|^\s*(?:mo|moh|moe))(?![a-zäöü])[,.!?:]?\s*(.*)$/i;
  let hinweisKeineSprache = false;

  function grundModus() { return Studio.cfg.aufJarvisHoeren && SR ? 'wach' : 'aus'; }

  function keineSprache(grund) {
    const el = $('#eingabeHinweis');
    el.hidden = false;
    el.textContent = grund + ' Schreiben Sie einfach – oder nutzen Sie das Mikrofon Ihrer Tastatur.';
    if (!hinweisKeineSprache) { hinweisKeineSprache = true; lokal('jarvis', 'Spracheingabe ist hier nicht verfügbar. Schreiben Sie mir einfach – das funktioniert ebenso gut.'); }
  }

  /** Zeigt kurz, was die Spracherkennung im Rufwort-Modus verstanden hat – so sieht man, ob „Hey MO“ ankommt. */
  let gehoertTimer = null;
  function gehoertZeigen(text) {
    const el = $('#eingabeHinweis');
    if (!el || !String(text).trim()) return;
    el.hidden = false;
    el.textContent = RUF.test(text) ? '✓ „Hey MO“ erkannt' : `Gehört: „${String(text).trim().slice(-60)}“ – zum Ansprechen „Hey MO“ sagen`;
    clearTimeout(gehoertTimer);
    gehoertTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function anzeigeHoeren() {
    const hoert = !!h.sr;
    $('#knopfMikro').classList.toggle('hoert', hoert && h.modus !== 'wach');
    $('#knopfGespraech').classList.toggle('aktiv', h.modus === 'gespraech');
    $('#knopfGespraech').setAttribute('aria-pressed', String(h.modus === 'gespraech'));
    if (window.Wolke) Wolke.setzeHoert(hoert && (h.modus !== 'wach' || h.befehl));
    if (h.modus === 'gespraech') statusSetzen(hoert ? (h.ausRuf ? 'Gespräch – ich höre zu …' : 'hört zu …') : h.wartet ? 'denkt …' : 'Gespräch');
    else if (h.modus === 'wach') statusSetzen(h.befehl ? 'Ja, bitte?' : 'wartet auf „Hey MO“');
    else if (h.modus === 'einmal') statusSetzen('hört zu …');
  }

  /** Gespräch nach dem Rufwort: wie der 🎧-Modus, endet bei Stille oder „Danke, das war's“ und wartet dann wieder auf „Hey MO“. */
  function gespraechBeginnen() {
    h.modus = 'gespraech'; h.ausRuf = true; h.stille = 0; h.befehl = false;
    anzeigeHoeren();
    statusSetzen('Gespräch – reden Sie einfach weiter');
  }

  function modusSetzen(m) {
    h.ausRuf = false;
    h.modus = m; h.stille = 0; h.befehl = false; h.ausloesen = null;
    hoerenPausieren();
    if (m === 'aus') statusSetzen(j.verbunden ? 'bereit' : 'Zentrale offline');
    anzeigeHoeren();
    if (m !== 'aus') hoerenStarten();
  }

  function hoerenPausieren() {
    if (h.sr) { const sr = h.sr; h.sr = null; try { sr.onend = null; sr.abort(); } catch (e) { /* egal */ } }
    anzeigeHoeren();
  }

  function abschicken(text) {
    h.stille = 0;
    if (h.modus === 'einmal') h.modus = grundModus();
    h.wartet = true;
    clearTimeout(h.wartetTimer);
    h.wartetTimer = setTimeout(() => { h.wartet = false; hoerenStarten(); }, 30000); // falls keine Antwort kommt
    anzeigeHoeren();
    senden(text);
  }

  /** Nach jeder Äußerung von MO: weiter zuhören, wenn ein freihändiger Modus aktiv ist. */
  function gesprochen() {
    window.dispatchEvent(new CustomEvent('mo:fertig'));
    h.wartet = false;
    clearTimeout(h.wartetTimer);
    if (h.modus === 'gespraech' || h.modus === 'wach') setTimeout(hoerenStarten, 350);
  }

  function hoerenStarten() {
    if (!SR || h.sr || sprichtGerade || h.wartet || document.hidden || h.modus === 'aus') return;
    const wachen = h.modus === 'wach' && !h.befehl;
    const sr = new SR();
    sr.lang = 'de-DE';
    sr.interimResults = true;
    sr.continuous = wachen; // im Rufwort-Modus durchgehend lauschen
    let endgueltig = '';
    sr.onresult = (e) => {
      let t = '';
      endgueltig = '';
      for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) endgueltig += e.results[i][0].transcript + ' '; }
      if (!wachen) { eingabe.value = t; return; }
      gehoertZeigen(t);
      const zwischen = RUF.exec(t);
      if (zwischen) eingabe.value = zwischen[1];
      const ruf = RUF.exec(endgueltig.trim());
      if (ruf) {
        const befehl = ruf[1].trim();
        if (befehl) h.ausloesen = befehl; else h.befehl = true;
        try { sr.stop(); } catch (err) { /* egal */ }
      }
    };
    sr.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        h.modus = 'aus';
        keineSprache('Das Mikrofon ist gesperrt.');
      } else if (e.error === 'network') {
        keineSprache('Die Spracherkennung braucht eine Internetverbindung.');
      } else if (e.error === 'audio-capture') {
        h.modus = 'aus';
        keineSprache('Es ist kein Mikrofon erreichbar (in Windows/Handy prüfen, ob eines angeschlossen und erlaubt ist).');
      }
    };
    // Sichtbar machen, dass das Mikrofon wirklich Ton bekommt
    sr.onaudiostart = () => { if (wachen) statusSetzen('🎙 wartet auf „Hey MO“'); };
    sr.onend = () => {
      if (h.sr !== sr) return;
      h.sr = null;
      anzeigeHoeren();
      if (wachen) {
        // „Hey MO“ startet ein Gespräch: danach hört MO nach jeder Antwort weiter zu – ohne erneutes Rufwort
        if (h.ausloesen) { const b = h.ausloesen; h.ausloesen = null; eingabe.value = ''; gespraechBeginnen(); abschicken(b); }
        else if (h.befehl) { h.befehl = false; gespraechBeginnen(); setTimeout(hoerenStarten, 150); }
        else setTimeout(hoerenStarten, 400); // Browser beenden Dauerlauschen gelegentlich – einfach weiter
        return;
      }
      const text = endgueltig.trim();
      if (text) {
        eingabe.value = '';
        if (ENDE.test(text) && h.modus !== 'einmal') {
          lokal('nutzer', text);
          const zurueck = grundModus();
          modusSetzen(zurueck);
          sprechen(zurueck === 'wach' ? 'Sehr wohl. Sagen Sie einfach „Hey MO“, wenn Sie mich brauchen.' : 'Sehr wohl. Ich bin da, wenn Sie mich brauchen.');
          return;
        }
        h.befehl = false;
        // „Mo, …“ am Satzanfang ist im Gespräch erlaubt, wird aber nicht mitgeschickt
        const ruf = RUF.exec(text);
        const inhalt = ruf ? ruf[1].trim() : text;
        if (!inhalt) { h.stille = 0; setTimeout(hoerenStarten, 200); return; }
        abschicken(inhalt);
        return;
      }
      // Nichts verstanden
      if (h.modus === 'einmal') { modusSetzen(grundModus()); return; }
      if (h.befehl) { h.befehl = false; anzeigeHoeren(); setTimeout(hoerenStarten, 300); return; }
      h.stille++;
      if (h.stille >= (h.ausRuf ? 3 : 4)) {
        const zurueck = grundModus();
        modusSetzen(zurueck);
        lokal('jarvis', zurueck === 'wach' ? 'Es ist still geworden – ich warte, bis Sie „Hey MO“ sagen.' : 'Es ist still geworden. Ich beende das Gespräch; tippen Sie auf 🎧, um fortzusetzen.');
        return;
      }
      setTimeout(hoerenStarten, 250);
    };
    try { sr.start(); h.sr = sr; anzeigeHoeren(); }
    catch (err) { h.sr = null; setTimeout(hoerenStarten, 1000); }
  }

  $('#knopfMikro').addEventListener('click', () => {
    stimmeFreischalten();
    if (!SR) { keineSprache('Dieser Browser bietet keine Spracheingabe.'); eingabe.focus(); return; }
    if (TTS) TTS.cancel();
    if (h.modus === 'einmal' || h.modus === 'gespraech') { modusSetzen(grundModus()); return; }
    modusSetzen('einmal');
  });

  $('#knopfGespraech').addEventListener('click', () => {
    stimmeFreischalten();
    if (!SR) { keineSprache('Freihändiges Sprechen ist in diesem Browser nicht möglich.'); return; }
    if (h.modus === 'gespraech') { modusSetzen(grundModus()); return; }
    if (TTS) TTS.cancel();
    h.modus = 'gespraech';
    anzeigeHoeren();
    sprechen('Ich höre.'); // danach öffnet sich das Mikrofon von selbst
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hoerenPausieren(); else hoerenStarten();
  });
  // Rufwort: startet nach der ersten Berührung (Browser verlangen eine Nutzeraktion fürs Mikrofon)
  document.addEventListener('pointerdown', () => { if (h.modus === 'aus' && grundModus() === 'wach') modusSetzen('wach'); }, { once: true });

  // ---------- Agenten-Karte (aus der Wolke) ----------
  const STATUS_DEUTSCH = { bereit: 'bereit', arbeitet: 'arbeitet', denkt: 'denkt nach', fehler: 'Fehler', wartet: 'wartet auf Freigabe', meldet: 'meldet etwas', getrennt: 'Zentrale offline', laeuft: 'läuft', haengt: 'hängt?', fertig: 'fertig', gestoppt: 'gestoppt', abgebrochen: 'abgebrochen' };

  function agentKarte(agent, x, y) {
    const k = $('#agentKarte');
    if (!agent) { k.hidden = true; return; }
    const s = agent.sitzungId && j.zustand ? j.zustand.sitzungen.find((q) => q.id === agent.sitzungId) : null;
    const zuletzt = agent.zuletzt ? new Date(agent.zuletzt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–';
    const art = agent.id === 'jarvis' ? 'Hauptagent' : agent.art === 'sitzung' ? 'Claude-Sitzung' : agent.art === 'fach' ? 'Fach-Agent · ' + esc(agent.bereichName || '') : 'System-Agent';
    k.innerHTML = `<p class="oberzeile">${art} · ${esc(STATUS_DEUTSCH[agent.status] || agent.status)}</p>
      <h3>${esc(agent.name)}</h3><p>${esc(agent.aufgabe || '')}</p>
      ${agent.letzteAktion ? `<p class="leise">Zuletzt (${zuletzt}): ${esc(agent.letzteAktion)}</p>` : ''}
      ${agent.art === 'fach' ? `<dl class="steckbrief">
        <dt>Bereich</dt><dd>${esc(agent.bereichName || '')}</dd>
        <dt>Rolle</dt><dd>${agent.unteragent ? `Unteragent im Team von „${esc(agent.elternName)}“ – übernimmt Teilaufgaben, die sein Spezialist ihm zuteilt` : agent.leitung ? 'Leitung – plant größere Aufträge im Bereich und verteilt sie an die Spezialisten' : (agent.unter || []).length ? `Spezialist mit ${agent.unter.length} Unteragenten – plant seinen Teil und führt die Ergebnisse zusammen` : 'Spezialist'}${agent.eigen ? ' · selbst erstellt' : ''}</dd>
        ${agent.methode ? `<dt>Arbeitsweise</dt><dd>${esc(agent.methode)}</dd>` : ''}
        ${(agent.unter || []).length ? `<dt>Team</dt><dd>${esc(agent.unter.map((u) => u.name).join(', '))}</dd>` : ''}
        <dt>Liefert</dt><dd>${esc(agent.liefert || '')}</dd>
        <dt>Rechte</dt><dd>${agent.rechte === 'web' ? 'Text + Websuche (nur lesen, mit Quellen)' : 'Nur Text – arbeitet mit Ihrem Auftrag und dem gemeinsamen Wissen'}</dd>
        <dt>Darf nie</dt><dd>veröffentlichen, senden, kaufen, löschen – liefert nur Entwürfe</dd>
        <dt>Start</dt><dd>nur nach Ihrer Freigabe, über MO</dd>
      </dl><div class="knopf-reihe"><button class="knopf klein haupt-knopf" data-j="agent-beauftragen" data-id="${esc(agent.unteragent ? agent.elternId : agent.id)}">${agent.unteragent ? 'Spezialist beauftragen …' : 'Beauftragen …'}</button></div>` : ''}
      ${s ? `<div class="zeilen">${esc(s.letzteZeilen.join('\n'))}</div><div class="knopf-reihe"><button class="knopf klein" data-j="details" data-id="${esc(s.id)}">Protokoll</button>${stoppbar(s) ? `<button class="knopf klein gefahr" data-j="stoppen" data-id="${esc(s.id)}">${s.art === 'bau' ? 'Abbrechen' : 'Stoppen'}</button>` : ''}</div>` : ''}
      <div class="knopf-reihe" style="margin-top:10px"><button class="knopf klein" id="agentKarteZu">Schließen</button></div>`;
    k.hidden = false;
    const b = k.offsetWidth || 320, hoehe = k.offsetHeight || 200;
    k.style.left = Math.max(16, Math.min(window.innerWidth - b - 16, x + 16)) + 'px';
    k.style.top = Math.max(80, Math.min(window.innerHeight - hoehe - 90, y - hoehe / 2)) + 'px';
    $('#agentKarteZu').onclick = () => { k.hidden = true; if (window.Wolke) Wolke.auswahlAufheben(); };
  }

  // ---------- Chat ein-/ausklappen (grundsätzlich eingeklappt – der Bildschirm gehört der Wolke) ----------
  function chatUmschalten(offen) {
    if (offen === undefined) offen = !document.body.classList.contains('chat-offen');
    document.body.classList.toggle('chat-offen', offen);
    $('#chatKnopf').setAttribute('aria-expanded', String(offen));
    if (offen) { j.ungelesen = 0; ungelesenZeigen(); verlaufEl.scrollTop = verlaufEl.scrollHeight; }
    window.dispatchEvent(new Event('studio-layout'));
  }
  $('#chatKnopf').addEventListener('click', () => { stimmeFreischalten(); chatUmschalten(true); });
  $('#chatZu').addEventListener('click', () => chatUmschalten(false));
  $('.chat-kopf').addEventListener('click', (ev) => { if (!ev.target.closest('button')) chatUmschalten(false); });
  // Dock „MO“: Schublade schließen und Chat öffnen bzw. (ohne Schublade) ein-/ausklappen
  $('#dock [data-ansicht="jarvis"]').addEventListener('click', () => {
    chatUmschalten($('#schublade').hidden ? undefined : true);
  }, true);

  verbinden();
  chatZeichnen();

  return {
    rufwortAnwenden() { if (h.modus === 'aus' || h.modus === 'wach') modusSetzen(grundModus()); },
    neuVerbinden() { j.verbunden = null; j.warVerbunden = false; j.hinweisOffline = false; j.zustand = null; j.lokal = []; j.gezeigt.clear(); j.ersteRunde = true; verbinden(); },
    get agentenStand() { return agentenStand; },
    get zustand() { return j.verbunden ? j.zustand : null; },
    get katalog() { return j.katalog; },
    agentKarte, sprechen, agentZuKarte
  };
})();
window.Jarvis = Jarvis;
