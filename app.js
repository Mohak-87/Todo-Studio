/* To-Do-Studio – Oberfläche (läuft komplett im Browser, keine Installation nötig) */
'use strict';

const SPEICHER = 'studio.einstellungen';
const STAND = 'studio.letzterStand';
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const $ = (s) => document.querySelector(s);
const inhalt = $('#inhalt');
const dlg = $('#dialog');
const dlgForm = $('#dialogInhalt');

let cfg = einstellungenLaden();
const z = {
  ansicht: 'heute', heute: null, ideen: null, termine: null, termineDatum: heuteIso(),
  typ: 'aufgabe', laedt: false, claudeFrage: null, offlineSeit: null
};

// ---------- Hilfen ----------

function heuteIso(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function plusTage(iso, n) { return datumPlusTage_(iso, n); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function datumLang(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}
function datumKurz(iso) { return iso ? datumKurz_(iso, heuteIso()) : ''; }
function jetztMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

function einstellungenLaden() {
  try { return Object.assign({ url: '', schluessel: '', beginn: '08:00', ende: '18:00' }, JSON.parse(localStorage.getItem(SPEICHER) || '{}')); }
  catch (e) { return { url: '', schluessel: '', beginn: '08:00', ende: '18:00' }; }
}
function einstellungenSpeichern() { try { localStorage.setItem(SPEICHER, JSON.stringify(cfg)); } catch (e) { /* privat-Modus */ } }

let toastTimer;
function toast(text, ms = 3500) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function banner(text) { const b = $('#banner'); b.hidden = !text; b.textContent = text || ''; }

// ---------- Verbindung zum Google-Skript ----------

async function api(action, daten = {}) {
  if (!cfg.url) throw new Error('Noch nicht verbunden – öffne die Einstellungen (⚙).');
  if (cfg.url === 'demo') return DemoStudio.aufruf(action, daten);
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({}, daten, { action, key: cfg.schluessel }))
  });
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('Keine gültige Antwort vom Google-Skript. Stimmt die Web-App-URL?'); }
  if (!j.ok) throw new Error(j.fehler || 'Unbekannter Fehler');
  return j.daten;
}

async function heuteLaden(still) {
  if (!cfg.url) { einstellungenDialog(true); return; }
  z.laedt = true;
  $('#knopfNeuLaden').classList.add('drehen');
  if (!still && !z.heute) zeichnen();
  try {
    z.heute = await api('heute', { arbeitsbeginn: cfg.beginn, arbeitsende: cfg.ende });
    z.offlineSeit = null;
    banner(z.heute.probleme && z.heute.probleme.length ? 'Teilweise nicht geladen: ' + z.heute.probleme.join(' · ') : '');
    try { localStorage.setItem(STAND, JSON.stringify({ zeit: Date.now(), daten: z.heute })); } catch (e) { /* egal */ }
  } catch (err) {
    const alt = (() => { try { return JSON.parse(localStorage.getItem(STAND) || 'null'); } catch (e) { return null; } })();
    if (alt && !z.heute) z.heute = alt.daten;
    banner((navigator.onLine ? 'Problem: ' + err.message : 'Du bist offline.') +
      (alt ? ' Ich zeige dir den Stand von ' + new Date(alt.zeit).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr.' : ''));
  } finally {
    z.laedt = false;
    $('#knopfNeuLaden').classList.remove('drehen');
    claudeAnzeige();
    zeichnen();
  }
}

function claudeAnzeige() {
  const p = $('#claudePunkt');
  if (cfg.url === 'demo') { p.textContent = 'Demo'; p.className = 'claude-punkt'; p.title = 'Demo-Modus mit Beispieldaten'; return; }
  const online = !!(z.heute && z.heute.claude && z.heute.claude.online);
  p.textContent = online ? '● Claude an' : '○ Claude aus';
  p.className = 'claude-punkt' + (online ? ' online' : '');
  p.title = online ? 'Dein PC-Helfer ist verbunden.' : 'Dein PC ist aus oder der Helfer läuft nicht. Alles andere funktioniert trotzdem.';
}

// ---------- Zeichnen ----------

function zeichnen() {
  const stunde = new Date().getHours();
  $('#gruss').textContent = stunde < 11 ? 'Guten Morgen!' : stunde < 17 ? 'Hallo!' : 'Guten Abend!';
  $('#kopfDatum').textContent = datumLang(heuteIso());
  document.querySelectorAll('.navi button').forEach((b) => b.classList.toggle('aktiv', b.dataset.ansicht === z.ansicht));
  const ansichten = { heute: zeigeHeute, aufgaben: zeigeAufgaben, termine: zeigeTermine, ideen: zeigeIdeen, mails: zeigeMails };
  inhalt.innerHTML = ansichten[z.ansicht]();
}

const LADEN = '<p class="laden">Einen Moment, ich hole deinen Tag …</p>';

function zeigeHeute() {
  const d = z.heute;
  if (!d) return z.laedt ? LADEN : '<p class="leer">Noch keine Daten. Tippe oben auf ⟳.</p>';
  const p = d.plan;
  let h = '';

  // Claude
  const c = d.claude || {};
  if (z.claudeFrage) {
    h += `<section class="karte claude-karte"><p class="oberzeile">Claude · deine Frage</p>
      <p class="leise">${esc(z.claudeFrage.frage || 'Tagesbriefing')}</p>
      ${z.claudeFrage.antwort ? `<p class="claude-text">${esc(z.claudeFrage.antwort)}</p>` : '<p class="claude-text leise">Claude denkt nach … (dauert meist 20–60 Sekunden)</p>'}
      ${z.claudeFrage.antwort ? '<div class="knopf-reihe"><button class="knopf klein" data-aktion="claude-schliessen">Schließen</button></div>' : ''}
    </section>`;
  }
  if (c.briefing) {
    h += `<section class="karte claude-karte"><p class="oberzeile">Claudes Tagesbriefing · ${new Date(c.briefing.erstellt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</p>
      <p class="claude-text">${esc(c.briefing.text)}</p>
      ${c.online ? '<div class="knopf-reihe"><button class="knopf klein" data-aktion="claude-briefing">Neu erstellen</button><button class="knopf klein claude" data-aktion="claude-fragen">Claude fragen</button></div>' : ''}
    </section>`;
  } else if (c.online) {
    h += `<section class="karte claude-karte"><p class="oberzeile">Claude ist bereit</p>
      <p class="leise">Dein PC läuft – Claude kann deinen Tag mit dir durchdenken.</p>
      <div class="knopf-reihe"><button class="knopf klein" data-aktion="claude-briefing">Tagesbriefing erstellen</button><button class="knopf klein claude" data-aktion="claude-fragen">Claude fragen</button></div>
    </section>`;
  }

  // Plan
  const a = p.auslastung;
  const fenster = Math.max(1, (zeitZuMin_(cfg.ende) - zeitZuMin_(cfg.beginn)));
  const tProz = Math.min(100, a.terminMin / fenster * 100);
  const aProz = Math.min(100 - tProz, a.aufgabenMin / fenster * 100);
  h += `<section class="karte plan-karte">
    <p class="oberzeile">Dein Plan${c.online || cfg.url === 'demo' ? '' : ' · Regel-Planer (Claude ist aus)'}</p>
    <h2>${esc(p.zusammenfassung)}</h2>
    <p class="motivation">${esc(p.motivation)}</p>
    <div class="auslastung">
      <div class="balken ${a.prozent > 100 ? 'voll' : ''}"><span class="b-termine" style="width:${tProz}%"></span><span class="b-aufgaben" style="width:${aProz}%"></span></div>
      <small>Termine ${dauerText_(a.terminMin)} · Aufgaben ${dauerText_(a.aufgabenMin)} · noch frei ${dauerText_(a.freiMin)} · Auslastung ${a.prozent} %</small>
    </div>
    ${p.hinweise.length ? '<ul class="hinweise">' + p.hinweise.map(hinweisHtml).join('') + '</ul>' : ''}
  </section>`;

  // Reihenfolge
  h += '<section class="karte"><h3>Vorgeschlagene Reihenfolge</h3>';
  if (p.ganztags.length) h += `<div class="chips" style="margin-bottom:8px">${p.ganztags.map((t) => `<span class="chip">Ganztägig: ${esc(t)}</span>`).join('')}</div>`;
  if (!p.reihenfolge.length) {
    h += '<p class="leise">Nichts Festes geplant. Ein guter Moment, um eine Aufgabe oder Idee anzugehen.</p>';
  } else {
    h += '<ul class="zeitstrahl">' + p.reihenfolge.map((r) => {
      const istNaechster = p.naechster && r.titel === p.naechster.titel && r.startMin === p.naechster.startMin;
      const klassen = [r.art === 'termin' ? 'termin' : 'vorschlag', r.vorbei ? 'vorbei' : '', istNaechster ? 'naechster' : ''].join(' ');
      let knoepfe = '';
      if (r.art === 'aufgabe') {
        knoepfe = `<button class="knopf klein" data-aktion="blocken" data-id="${esc(r.id)}" data-start="${r.startMin}" data-ende="${r.endeMin}" data-titel="${esc(r.titel)}" title="Als Zeitblock in den Kalender – erscheint dann auch auf der Watch">📅</button>
          <button class="haken" data-aktion="haken" data-id="${esc(r.id)}" aria-label="Erledigt"></button>`;
      } else if (r.art === 'mails') {
        knoepfe = '<button class="knopf klein" data-aktion="ansicht" data-ziel="mails">Ansehen</button>';
      }
      return `<li class="${klassen}"><span class="uhr">${minZuZeit_(r.startMin)}</span>
        <span class="titel-block" ${r.art === 'termin' && r.id ? `data-aktion="termin-oeffnen" data-id="${esc(r.id)}" style="cursor:pointer"` : ''}>
          <span class="titel">${esc(r.titel)}</span>
          <small>${r.art === 'termin' ? 'Termin bis ' + minZuZeit_(r.endeMin) + (r.ort ? ' · ' + esc(r.ort) : '') : 'Vorschlag · ' + dauerText_(r.endeMin - r.startMin)}${istNaechster ? ' · als Nächstes' : ''}</small>
        </span>
        <span class="zeile-knoepfe">${knoepfe}</span></li>`;
    }).join('') + '</ul>';
  }
  if (p.nichtEingeplant.length) h += `<p class="leise" style="margin-top:10px">Passt heute nicht mehr rein: ${p.nichtEingeplant.map(esc).join(', ')}</p>`;
  h += '</section>';

  // Mails
  const wichtig = d.mails.filter((m) => m.wichtig);
  if (wichtig.length) {
    h += `<section class="karte"><h3>Wichtige Mails <button class="knopf klein" data-aktion="ansicht" data-ziel="mails">Alle ${d.mails.length}</button></h3>
      <ul class="liste">${wichtig.slice(0, 3).map(mailHtml).join('')}</ul></section>`;
  }
  return h;
}

function hinweisHtml(h) {
  const icon = { warnung: '⚠', konflikt: '⛔', tipp: '💡', lob: '🎉' }[h.art] || '•';
  const knopf = h.schieben && h.schieben.length
    ? `<br><button class="knopf klein" data-aktion="schieben" data-ids="${esc(h.schieben.join(','))}">Auf morgen schieben</button>` : '';
  return `<li class="hinweis ${h.art}"><b>${icon}</b><span class="text">${esc(h.text)}${knopf}</span></li>`;
}

function aufgabenDaten() { return (z.heute && z.heute.aufgaben) || { offen: [], erledigtHeute: [] }; }

function aufgabeHtml(a) {
  const heute = heuteIso();
  const chips = [];
  if (a.prio === 1) chips.push('<span class="chip p1">wichtig</span>');
  if (a.prio === 3) chips.push('<span class="chip p3">niedrig</span>');
  if (a.faellig) chips.push(`<span class="chip ${a.faellig < heute && !a.erledigt ? 'rot' : ''}">${esc(datumKurz(a.faellig))}</span>`);
  chips.push(`<span class="chip">${dauerText_(a.dauer)}</span>`);
  return `<li class="${a.erledigt ? 'erledigt' : ''}">
    <button class="haken ${a.erledigt ? 'an' : ''}" data-aktion="${a.erledigt ? 'zurueck' : 'haken'}" data-id="${esc(a.id)}" aria-label="${a.erledigt ? 'Wieder öffnen' : 'Erledigt'}">${a.erledigt ? '✓' : ''}</button>
    <button class="haupt" data-aktion="aufgabe-oeffnen" data-id="${esc(a.id)}"><span class="titel">${esc(a.titel)}</span><span class="chips">${chips.join('')}</span></button>
  </li>`;
}

function zeigeAufgaben() {
  if (!z.heute) return z.laedt ? LADEN : '<p class="leer">Noch keine Daten.</p>';
  const heute = heuteIso();
  const { offen, erledigtHeute } = aufgabenDaten();
  const nachPrio = (a, b) => a.prio - b.prio || a.titel.localeCompare(b.titel);
  const gruppen = [
    ['Überfällig', offen.filter((a) => a.faellig && a.faellig < heute).sort((a, b) => a.faellig.localeCompare(b.faellig)), 'rot'],
    ['Heute', offen.filter((a) => a.faellig === heute).sort(nachPrio)],
    ['Demnächst', offen.filter((a) => a.faellig && a.faellig > heute).sort((a, b) => a.faellig.localeCompare(b.faellig) || nachPrio(a, b))],
    ['Ohne Datum', offen.filter((a) => !a.faellig).sort(nachPrio)],
    ['Heute erledigt 🎉', erledigtHeute]
  ];
  let h = `<div class="knopf-reihe" style="justify-content:space-between;flex-direction:row"><span class="leise">${offen.length} offen · ${erledigtHeute.length} heute erledigt</span>
    <button class="knopf klein haupt-knopf" data-aktion="aufgabe-neu">＋ Aufgabe</button></div>`;
  let leer = true;
  gruppen.forEach(([titel, liste, klasse]) => {
    if (!liste.length) return;
    leer = false;
    h += `<p class="gruppe-titel ${klasse || ''}">${titel} (${liste.length})</p><ul class="liste">${liste.map(aufgabeHtml).join('')}</ul>`;
  });
  if (leer) h += '<p class="leer">Keine offenen Aufgaben. Genieß den freien Kopf – oder halte unten eine neue fest.</p>';
  h += '<p class="leise" style="margin-top:14px">Deine Aufgaben liegen in Google Tasks – du siehst sie auch in Gmail, im Google Kalender und in der Tasks-App.</p>';
  return h;
}

function zeigeTermine() {
  const d = z.termineDatum;
  let h = `<div class="datum-navi">
    <button class="knopf" data-aktion="tag" data-tage="-1" aria-label="Vorheriger Tag">◀</button>
    <strong>${esc(datumLang(d))}${d === heuteIso() ? ' · heute' : ''}</strong>
    <button class="knopf" data-aktion="tag" data-tage="1" aria-label="Nächster Tag">▶</button>
  </div>
  <div class="knopf-reihe" style="margin-top:0;flex-direction:row;justify-content:space-between">
    <button class="knopf klein" data-aktion="tag" data-tage="0">Heute</button>
    <button class="knopf klein haupt-knopf" data-aktion="termin-neu">＋ Termin</button>
  </div>`;
  if (!z.termine) { terminLaden(); return h + LADEN; }
  if (!z.termine.length) return h + '<p class="leer">Keine Termine an diesem Tag.</p>';
  h += '<ul class="liste" style="margin-top:12px">' + z.termine.map((t) => `<li>
    <button class="haupt" data-aktion="termin-oeffnen" data-id="${esc(t.id)}">
      <span class="titel">${esc(t.titel)}</span>
      <span class="chips"><span class="chip gruen">${t.ganztags ? 'ganztägig' : esc(t.start + '–' + t.ende)}</span>${t.ort ? `<span class="chip">${esc(t.ort)}</span>` : ''}${t.serie ? '<span class="chip">Serie</span>' : ''}</span>
    </button></li>`).join('') + '</ul>';
  h += '<p class="leise" style="margin-top:14px">Ändern oder Löschen fragt immer erst nach. Neue Termine erscheinen über den iPhone-Kalender auch auf deiner Apple Watch.</p>';
  return h;
}

async function terminLaden() {
  const datum = z.termineDatum;
  try {
    const t = await api('termine.liste', { von: datum, bis: datum });
    if (datum === z.termineDatum) { z.termine = t; if (z.ansicht === 'termine') zeichnen(); }
  } catch (err) { toast(err.message); z.termine = []; if (z.ansicht === 'termine') zeichnen(); }
}

function zeigeIdeen() {
  if (!z.ideen) { ideenLaden(); return LADEN; }
  let h = '<p class="leise">Dein Ideen- und Erinnerungsspeicher. Unten einfach „Idee“ wählen und tippen oder diktieren.</p>';
  if (!z.ideen.length) return h + '<p class="leer">Noch keine Ideen gespeichert. Die erste ist die schwerste – leg los! 💡</p>';
  h += '<ul class="liste">' + z.ideen.map((i) => `<li style="flex-direction:column;gap:8px">
    <span class="titel">${esc(i.text)}</span>
    <span class="chips" style="justify-content:space-between;width:100%;align-items:center">
      <span class="chip">${esc(i.erstellt ? datumKurz(i.erstellt.slice(0, 10)) : '')}</span>
      <span class="zeile-knoepfe">
        <button class="knopf klein" data-aktion="idee-aufgabe" data-id="${esc(i.id)}">→ Aufgabe</button>
        <button class="knopf klein" data-aktion="idee-bearbeiten" data-id="${esc(i.id)}">Bearbeiten</button>
        <button class="knopf klein gefahr" data-aktion="idee-loeschen" data-id="${esc(i.id)}">Löschen</button>
      </span>
    </span></li>`).join('') + '</ul>';
  return h;
}

async function ideenLaden() {
  try { z.ideen = await api('ideen.liste'); } catch (err) { toast(err.message); z.ideen = []; }
  if (z.ansicht === 'ideen') zeichnen();
}

function mailHtml(m) {
  return `<li class="mail ${m.wichtig ? 'wichtig' : ''}" style="flex-direction:column;gap:6px">
    <span><span class="betreff">${esc(m.betreff)}</span><br><span class="leise">${esc(m.von)} · ${esc(datumKurz(m.datum.slice(0, 10)))} ${esc(m.datum.slice(11, 16))}</span></span>
    <span class="auszug">${esc(m.auszug)}</span>
    <span class="zeile-knoepfe"><a class="knopf klein" href="${esc(m.link)}" target="_blank" rel="noopener">In Gmail öffnen</a>
      <button class="knopf klein" data-aktion="mail-aufgabe" data-id="${esc(m.id)}">→ Aufgabe</button></span>
  </li>`;
}

function zeigeMails() {
  if (!z.heute) return z.laedt ? LADEN : '<p class="leer">Noch keine Daten.</p>';
  const m = z.heute.mails;
  let h = `<div class="knopf-reihe" style="margin-top:0;flex-direction:row;justify-content:space-between;align-items:center">
    <span class="leise">Ungelesen, letzte 3 Tage, ohne Werbung</span><button class="knopf klein" data-aktion="mails-neu">⟳ Neu laden</button></div>`;
  h += '<p class="leise">Das Studio liest nur. Antworten schreibst du in Gmail – hier wird nie etwas gesendet oder gelöscht.</p>';
  if (!m.length) return h + '<p class="leer">Posteingang ruhig – keine ungelesenen Mails. 👌</p>';
  return h + '<ul class="liste">' + m.map(mailHtml).join('') + '</ul>';
}

// ---------- Dialoge ----------

function dialogOeffnen(html) {
  return new Promise((resolve) => {
    dlgForm.innerHTML = html;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve({ wert: dlg.returnValue, daten: Object.fromEntries(new FormData(dlgForm)) }), { once: true });
    dlg.showModal();
    const erstes = dlgForm.querySelector('input:not([type=hidden]),textarea');
    if (erstes && !('ontouchstart' in window)) erstes.focus();
  });
}

async function bestaetigen(titel, textHtml, jaText = 'Ja', gefahr = false) {
  const r = await dialogOeffnen(`<h2>${esc(titel)}</h2><div>${textHtml}</div>
    <div class="knopf-reihe"><button class="knopf ${gefahr ? 'gefahr' : 'haupt-knopf'}" value="ja">${esc(jaText)}</button>
    <button class="knopf" value="nein" formnovalidate>Abbrechen</button></div>`);
  return r.wert === 'ja';
}

const DAUERN = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

async function aufgabeDialog(a) {
  const neu = !a;
  a = a || { titel: '', notizen: '', faellig: '', prio: 2, dauer: 30 };
  const r = await dialogOeffnen(`<h2>${neu ? 'Neue Aufgabe' : 'Aufgabe bearbeiten'}</h2>
    <label class="feld"><span>Was ist zu tun?</span><input name="titel" required value="${esc(a.titel)}"></label>
    <div class="feld-reihe">
      <label class="feld"><span>Fällig am</span><input type="date" name="faellig" value="${esc(a.faellig || '')}"></label>
      <label class="feld"><span>Priorität</span><select name="prio">
        <option value="1" ${a.prio === 1 ? 'selected' : ''}>Wichtig</option>
        <option value="2" ${a.prio === 2 ? 'selected' : ''}>Normal</option>
        <option value="3" ${a.prio === 3 ? 'selected' : ''}>Niedrig</option></select></label>
    </div>
    <label class="feld"><span>Geschätzte Dauer</span><select name="dauer">${DAUERN.map((d) => `<option value="${d}" ${a.dauer === d ? 'selected' : ''}>${dauerText_(d)}</option>`).join('')}</select></label>
    <label class="feld"><span>Notizen</span><textarea name="notizen">${esc(a.notizen)}</textarea></label>
    ${a.link ? `<p class="leise"><a href="${esc(a.link)}" target="_blank" rel="noopener">In Google Tasks öffnen</a></p>` : ''}
    <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start">
      <button class="knopf haupt-knopf" value="speichern">Speichern</button>
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      ${neu ? '' : '<button class="knopf gefahr" value="loeschen" formnovalidate style="margin-right:auto">Löschen</button>'}
    </div>`);
  if (r.wert === 'speichern') {
    const daten = { titel: r.daten.titel.trim(), notizen: r.daten.notizen, faellig: r.daten.faellig || '', prio: Number(r.daten.prio), dauer: Number(r.daten.dauer) };
    await ausfuehren(neu ? 'aufgabe.neu' : 'aufgabe.aendern', neu ? daten : Object.assign({ id: a.id }, daten), neu ? 'Aufgabe gespeichert ✓' : 'Aufgabe aktualisiert ✓');
  } else if (r.wert === 'loeschen') {
    if (await bestaetigen('Aufgabe löschen?', `„${esc(a.titel)}“ wird aus Google Tasks entfernt.`, 'Löschen', true)) {
      await ausfuehren('aufgabe.loeschen', { id: a.id }, 'Aufgabe gelöscht');
    }
  }
}

function terminText(t) {
  if (!t) return '';
  return `${esc(datumKurz(t.datum))}${t.ganztags || !t.start ? ' · ganztägig' : ' · ' + esc(t.start) + '–' + esc(t.ende)}${t.ort ? ' · ' + esc(t.ort) : ''}`;
}

async function terminDialog(t, vorschlag) {
  const neu = !t;
  const v = t || {
    titel: (vorschlag && vorschlag.titel) || '', datum: (vorschlag && vorschlag.datum) || z.termineDatum,
    start: (vorschlag && vorschlag.zeit) || '', ende: (vorschlag && vorschlag.endeZeit) || '', ganztags: !!(vorschlag && !vorschlag.zeit), ort: '', notizen: ''
  };
  const r = await dialogOeffnen(`<h2>${neu ? 'Neuer Termin' : 'Termin bearbeiten'}</h2>
    ${vorschlag ? '<p class="leise">So habe ich dich verstanden – prüf kurz und speichere.</p>' : ''}
    <label class="feld"><span>Titel</span><input name="titel" required value="${esc(v.titel)}"></label>
    <label class="feld"><span>Datum</span><input type="date" name="datum" required value="${esc(v.datum)}"></label>
    <label class="check"><input type="checkbox" name="ganztags" ${v.ganztags ? 'checked' : ''}> ganztägig</label>
    <div class="feld-reihe">
      <label class="feld"><span>Beginn</span><input type="time" name="start" value="${esc(v.start || '')}"></label>
      <label class="feld"><span>Ende</span><input type="time" name="ende" value="${esc(v.ende || '')}"></label>
    </div>
    <label class="feld"><span>Ort</span><input name="ort" value="${esc(v.ort)}"></label>
    <label class="feld"><span>Notizen</span><textarea name="notizen">${esc(v.notizen)}</textarea></label>
    ${t && t.serie ? '<p class="leise">Dieser Termin gehört zu einer Serie. Änderungen betreffen nur diesen einen Termin.</p>' : ''}
    ${t && t.link ? `<p class="leise"><a href="${esc(t.link)}" target="_blank" rel="noopener">In Google Kalender öffnen</a></p>` : ''}
    <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start">
      <button class="knopf haupt-knopf" value="speichern">${neu ? 'Eintragen' : 'Änderung prüfen'}</button>
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      ${neu ? '' : '<button class="knopf gefahr" value="loeschen" formnovalidate style="margin-right:auto">Löschen …</button>'}
    </div>`);

  if (r.wert === 'speichern') {
    const ganztags = r.daten.ganztags === 'on' || !r.daten.start;
    const daten = {
      titel: r.daten.titel.trim(), datum: r.daten.datum, start: ganztags ? '' : r.daten.start,
      ende: ganztags ? '' : (r.daten.ende || ''), ort: r.daten.ort, notizen: r.daten.notizen
    };
    if (!ganztags && daten.ende && daten.ende <= daten.start) { toast('Das Ende muss nach dem Beginn liegen.'); return terminDialog(t, vorschlag); }
    if (neu) {
      await ausfuehren('termin.neu', daten, 'Termin eingetragen ✓');
    } else {
      const nachher = { datum: daten.datum, ganztags, start: daten.start, ende: daten.ende || '(automatisch +1 Std.)', ort: daten.ort };
      const ok = await bestaetigen('Termin wirklich ändern?', `<div class="vergleich">
        <div><b>${esc(t.titel)}</b></div><div>Vorher: ${terminText(t)}</div>
        <div>Nachher: <b>${esc(daten.titel)}</b> · ${terminText(nachher)}</div></div>
        <p class="leise">Die Änderung wird direkt in deinem Google Kalender gespeichert.</p>`, 'Ja, ändern');
      if (ok) await ausfuehren('termin.aendern', Object.assign({ id: t.id, bestaetigt: true }, daten), 'Termin geändert ✓');
      else toast('Nichts geändert.');
    }
  } else if (r.wert === 'loeschen') {
    const ok = await bestaetigen('Termin löschen?', `<div class="vergleich"><b>${esc(t.titel)}</b><br>${terminText(t)}</div>
      <p>Der Termin wird aus deinem Google Kalender gelöscht. Das kann ich nicht rückgängig machen.</p>`, 'Endgültig löschen', true);
    if (ok) await ausfuehren('termin.loeschen', { id: t.id, bestaetigt: true }, 'Termin gelöscht');
    else toast('Nichts gelöscht.');
  }
}

async function einstellungenDialog(erstStart) {
  const r = await dialogOeffnen(`<h2>${erstStart ? 'Willkommen im To-Do-Studio 👋' : 'Einstellungen'}</h2>
    ${erstStart ? '<p>Verbinde das Studio einmal mit deinem Google-Skript (Anleitung, Schritt 5). Oder schau dir zuerst die Demo mit Beispieldaten an.</p>' : ''}
    <label class="feld"><span>Web-App-URL deines Google-Skripts (endet auf /exec)</span><input name="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url === 'demo' ? '' : cfg.url)}"></label>
    <label class="feld"><span>Studio-Schlüssel (aus dem Skript-Protokoll)</span><input name="schluessel" type="password" autocomplete="off" value="${esc(cfg.schluessel)}"></label>
    <div class="feld-reihe">
      <label class="feld"><span>Arbeitsbeginn</span><input type="time" name="beginn" value="${esc(cfg.beginn)}"></label>
      <label class="feld"><span>Arbeitsende</span><input type="time" name="ende" value="${esc(cfg.ende)}"></label>
    </div>
    <p class="leise">Schlüssel und URL bleiben nur auf diesem Gerät gespeichert.</p>
    <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start">
      <button class="knopf haupt-knopf" value="speichern" formnovalidate>Speichern & testen</button>
      <button class="knopf" value="demo" formnovalidate>Demo ansehen</button>
      ${erstStart ? '' : '<button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>'}
    </div>`);
  if (r.wert === 'demo') {
    cfg.url = 'demo'; einstellungenSpeichern();
    z.heute = null; z.ideen = null; z.termine = null;
    toast('Demo-Modus: alles nur Beispieldaten, nichts wird gespeichert.');
    return heuteLaden();
  }
  if (r.wert !== 'speichern') { if (erstStart && !cfg.url) einstellungenDialog(true); return; }
  const url = (r.daten.url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
    toast('Die URL sieht nicht richtig aus. Sie beginnt mit https://script.google.com/macros/s/ und endet auf /exec.', 6000);
    return einstellungenDialog(erstStart);
  }
  cfg = Object.assign(cfg, { url, schluessel: (r.daten.schluessel || '').trim(), beginn: r.daten.beginn || '08:00', ende: r.daten.ende || '18:00' });
  einstellungenSpeichern();
  try {
    await api('ping');
    toast('Verbunden ✓ Schön, dass du da bist!');
    z.heute = null; z.ideen = null; z.termine = null;
    heuteLaden();
  } catch (err) {
    toast('Verbindung klappt noch nicht: ' + err.message, 7000);
    einstellungenDialog(erstStart);
  }
}

// ---------- Aktionen ----------

async function ausfuehren(action, daten, erfolg) {
  try {
    const r = await api(action, daten);
    if (erfolg) toast(erfolg);
    if (action.indexOf('termin') === 0) z.termine = null;
    if (action.indexOf('idee') === 0) z.ideen = null;
    await heuteLaden(true);
    return r;
  } catch (err) {
    toast('Hat nicht geklappt: ' + err.message, 6000);
    return null;
  }
}

function findeAufgabe(id) {
  const d = aufgabenDaten();
  return d.offen.concat(d.erledigtHeute).find((a) => a.id === id);
}
function findeTermin(id) {
  return (z.termine || []).concat((z.heute && z.heute.termine) || []).find((t) => t.id === id);
}

inhalt.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-aktion]');
  if (!el) return;
  const { aktion, id } = el.dataset;
  switch (aktion) {
    case 'haken': {
      el.classList.add('an'); el.textContent = '✓';
      const a = findeAufgabe(id);
      await ausfuehren('aufgabe.erledigt', { id, erledigt: true }, '✓ ' + (a ? a.titel : 'Erledigt') + ' – stark!');
      break;
    }
    case 'zurueck': await ausfuehren('aufgabe.erledigt', { id, erledigt: false }, 'Wieder offen'); break;
    case 'aufgabe-oeffnen': aufgabeDialog(findeAufgabe(id)); break;
    case 'aufgabe-neu': aufgabeDialog(null); break;
    case 'termin-oeffnen': { const t = findeTermin(id); if (t) terminDialog(t); break; }
    case 'termin-neu': terminDialog(null); break;
    case 'tag': {
      const n = Number(el.dataset.tage);
      z.termineDatum = n === 0 ? heuteIso() : plusTage(z.termineDatum, n);
      z.termine = null; zeichnen(); break;
    }
    case 'ansicht': wechsle(el.dataset.ziel); break;
    case 'blocken': {
      const datum = heuteIso(), start = minZuZeit_(Number(el.dataset.start)), ende = minZuZeit_(Number(el.dataset.ende));
      const ok = await bestaetigen('Zeitblock eintragen?', `Ich trage <b>„${esc(el.dataset.titel)}“</b> heute von ${start} bis ${ende} Uhr als Termin in deinen Google Kalender ein. So erinnert dich auch deine Apple Watch daran.`, 'Eintragen');
      if (ok) await ausfuehren('termin.neu', { titel: '✓ ' + el.dataset.titel, datum, start, ende, notizen: 'Zeitblock aus dem To-Do-Studio', erinnerungMin: 5 }, 'Zeitblock eingetragen ✓');
      break;
    }
    case 'schieben': {
      const ids = el.dataset.ids.split(',').filter(Boolean);
      const titel = ids.map((i) => (findeAufgabe(i) || {}).titel).filter(Boolean);
      const ok = await bestaetigen('Auf morgen verschieben?', 'Neues Fälligkeitsdatum morgen für: ' + titel.map((t) => `„${esc(t)}“`).join(', '), 'Verschieben');
      if (ok) {
        const morgen = plusTage(heuteIso(), 1);
        for (const i of ids) await api('aufgabe.aendern', { id: i, faellig: morgen }).catch((err) => toast(err.message));
        toast('Verschoben – dein Tag hat jetzt wieder Luft.');
        heuteLaden(true);
      }
      break;
    }
    case 'idee-aufgabe': await ausfuehren('idee.zuAufgabe', { id }, 'Aus der Idee wird eine Aufgabe ✓'); break;
    case 'idee-bearbeiten': {
      const i = (z.ideen || []).find((x) => x.id === id);
      const r = await dialogOeffnen(`<h2>Idee bearbeiten</h2><label class="feld"><span>Idee</span><textarea name="text" required>${esc(i.text)}</textarea></label>
        <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start"><button class="knopf haupt-knopf" value="ok">Speichern</button><button class="knopf" value="x" formnovalidate>Abbrechen</button></div>`);
      if (r.wert === 'ok') await ausfuehren('idee.aendern', { id, text: r.daten.text.trim() }, 'Gespeichert ✓');
      break;
    }
    case 'idee-loeschen': {
      const i = (z.ideen || []).find((x) => x.id === id);
      if (await bestaetigen('Idee löschen?', `„${esc(i ? i.text : '')}“`, 'Löschen', true)) await ausfuehren('idee.loeschen', { id }, 'Idee gelöscht');
      break;
    }
    case 'mail-aufgabe': await ausfuehren('mail.zuAufgabe', { id }, 'Mail als Aufgabe für heute gespeichert ✓'); break;
    case 'mails-neu': {
      try { z.heute.mails = await api('mails.liste', { frisch: true }); zeichnen(); } catch (err) { toast(err.message); }
      break;
    }
    case 'claude-fragen': claudeFragen(); break;
    case 'claude-briefing': claudeFragen('briefing'); break;
    case 'claude-schliessen': z.claudeFrage = null; zeichnen(); break;
  }
});

async function claudeFragen(art) {
  let frage = '';
  if (art !== 'briefing') {
    const r = await dialogOeffnen(`<h2>Claude fragen</h2>
      <p class="leise">Claude sieht deine Termine, Aufgaben und die Betreffzeilen wichtiger Mails von heute – und macht nur Vorschläge.</p>
      <label class="feld"><span>Deine Frage</span><textarea name="frage" required placeholder="z. B. „Wie schaffe ich heute alles bis 17 Uhr?“"></textarea></label>
      <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start"><button class="knopf haupt-knopf" value="ok">Fragen</button><button class="knopf" value="x" formnovalidate>Abbrechen</button></div>`);
    if (r.wert !== 'ok') return;
    frage = r.daten.frage.trim();
  }
  try {
    const r = await api('claude.fragen', { frage, art: art || 'frage' });
    if (r.offline) { toast(r.hinweis, 6000); return; }
    z.claudeFrage = { id: r.id, frage: frage || 'Bitte erstelle mein Tagesbriefing.', antwort: null };
    wechsle('heute');
    const bis = Date.now() + 4 * 60 * 1000;
    while (Date.now() < bis && z.claudeFrage && z.claudeFrage.id === r.id) {
      await new Promise((ok) => setTimeout(ok, 4000));
      const a = await api('claude.antwort', { id: r.id });
      if (a.status === 'fertig') {
        z.claudeFrage.antwort = a.antwort;
        if (art === 'briefing') { z.claudeFrage = null; await heuteLaden(true); } else zeichnen();
        return;
      }
    }
    if (z.claudeFrage && !z.claudeFrage.antwort) { z.claudeFrage.antwort = 'Claude hat gerade zu lange gebraucht. Läuft der Helfer auf deinem PC noch?'; zeichnen(); }
  } catch (err) { toast(err.message, 6000); }
}

function wechsle(ansicht) {
  z.ansicht = ansicht;
  if (ansicht === 'ideen' && cfg.url) z.ideen = null;
  zeichnen();
  window.scrollTo(0, 0);
}

$('#navi').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-ansicht]');
  if (b) wechsle(b.dataset.ansicht);
});
$('#knopfNeuLaden').addEventListener('click', () => { z.termine = null; z.ideen = null; heuteLaden(); });
$('#knopfEinstellungen').addEventListener('click', () => einstellungenDialog(false));

// ---------- Schnelleingabe & Diktat ----------

const eingabe = $('#eingabeText');

function typSetzen(typ) {
  z.typ = typ;
  document.querySelectorAll('.typ-wahl button').forEach((b) => b.classList.toggle('aktiv', b.dataset.typ === typ));
  eingabe.placeholder = {
    aufgabe: 'z. B. „Morgen Steuerberater anrufen, wichtig, 15 Minuten“',
    termin: 'z. B. „Freitag um 14 Uhr Zahnarzt“',
    idee: 'z. B. „Newsletter mit Kundenstimmen starten“'
  }[typ];
}
document.querySelector('.typ-wahl').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-typ]');
  if (b) { typSetzen(b.dataset.typ); eingabe.focus(); }
});
eingabe.addEventListener('input', () => {
  const m = eingabe.value.trim().toLowerCase().match(/^(idee|notiz|termin|aufgabe)\b/);
  if (m) { typSetzen(m[1] === 'notiz' ? 'idee' : m[1]); z.typAuto = true; }
});

$('#eingabe').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = eingabe.value.trim();
  if (!text) { eingabe.focus(); return; }
  try {
    const r = await api('schnell', { text, typ: z.typ });
    eingabe.value = '';
    if (z.typAuto) { typSetzen('aufgabe'); z.typAuto = false; }
    if (r.typ === 'termin') { terminDialog(null, r.verstanden); return; }
    if (r.typ === 'idee') { toast('💡 Idee gespeichert'); z.ideen = null; if (z.ansicht === 'ideen') zeichnen(); return; }
    const a = r.eintrag;
    toast('✓ Aufgabe: ' + a.titel + (a.faellig ? ' · ' + datumKurz(a.faellig) : '') + (a.prio === 1 ? ' · wichtig' : ''));
    heuteLaden(true);
  } catch (err) { toast('Hat nicht geklappt: ' + err.message, 6000); }
});

let erkennung = null;
$('#knopfMikro').addEventListener('click', () => {
  const knopf = $('#knopfMikro');
  if (!SR) {
    hinweisOhneSprache();
    eingabe.focus();
    return;
  }
  if (erkennung) { erkennung.stop(); return; }
  erkennung = new SR();
  erkennung.lang = 'de-DE';
  erkennung.interimResults = true;
  erkennung.continuous = false;
  const vorher = eingabe.value ? eingabe.value + ' ' : '';
  erkennung.onresult = (e) => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    eingabe.value = vorher + t;
    eingabe.dispatchEvent(new Event('input'));
  };
  erkennung.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast('Das Mikrofon ist hier blockiert. Erlaube es in den Browser-Einstellungen – oder nutze das Mikrofon deiner Tastatur.', 7000);
    } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
      toast('Spracheingabe hat nicht geklappt (' + e.error + '). Tipp stattdessen oder nutze das Tastatur-Mikrofon.', 6000);
    }
    hinweisOhneSprache();
  };
  erkennung.onend = () => { knopf.classList.remove('hoert'); erkennung = null; if (eingabe.value.trim()) toast('Passt der Text? Dann tippe auf ＋.'); };
  try {
    erkennung.start();
    knopf.classList.add('hoert');
  } catch (err) { erkennung = null; hinweisOhneSprache(); }
});

function hinweisOhneSprache() {
  const h = $('#eingabeHinweis');
  h.hidden = false;
  h.textContent = 'Spracheingabe geht hier nicht direkt. Tipp ins Feld und nutze das 🎙 auf deiner Handy-Tastatur – das klappt überall.';
}

// ---------- Start ----------

typSetzen('aufgabe');
if (!SR) $('#knopfMikro').title = 'Spracheingabe nicht verfügbar – nutze das Tastatur-Mikrofon';
zeichnen();
if (cfg.url) heuteLaden(); else einstellungenDialog(true);

setInterval(() => { if (document.visibilityState === 'visible' && cfg.url) heuteLaden(true); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cfg.url && z.heute && z.heute.datum !== heuteIso()) heuteLaden(true);
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Offline-Modus weiter */ });
}
