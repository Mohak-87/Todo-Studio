/* Todo Studio – Todo-Ansichten (Heute, Aufgaben, Termine, Ideen, Mails) und Google-Verbindung.
   Funktioniert auch, wenn der Laptop (Zentrale) aus ist. */
'use strict';

const Studio = (() => {
  const SPEICHER = 'studio.einstellungen';
  const STAND = 'studio.letzterStand';
  const $ = (s) => document.querySelector(s);
  const inhalt = $('#inhalt');
  const dlg = $('#dialog');
  const dlgForm = $('#dialogInhalt');
  const TITEL = { heute: 'Heute', aufgaben: 'Aufgaben', termine: 'Termine', ideen: 'Ideen', mails: 'Mails', sitzungen: 'Arbeit & Team' };
  const fremdeAnsichten = {};

  let cfg = einstellungenLaden();
  const z = { ansicht: 'jarvis', heute: null, ideen: null, termine: null, termineDatum: heuteIso(), laedt: false };

  // ---------- Hilfen ----------
  function heuteIso(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function datumLang(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function datumKurz(iso) { return iso ? datumKurz_(iso, heuteIso()) : ''; }

  function einstellungenLaden() {
    const std = { url: '', schluessel: '', beginn: '08:00', ende: '18:00', zentrale: '', zentraleSchluessel: '', stimme: true };
    try { return Object.assign(std, JSON.parse(localStorage.getItem(SPEICHER) || '{}')); } catch (e) { return std; }
  }
  function einstellungenSpeichern() { try { localStorage.setItem(SPEICHER, JSON.stringify(cfg)); } catch (e) { /* privater Modus */ } }

  let toastTimer;
  function toast(text, ms = 3800) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  function banner(text) { const b = $('#banner'); b.hidden = !text; b.textContent = text || ''; }

  function pille(id, zustand, titel) {
    const p = $(id);
    p.classList.toggle('an', zustand === 'an');
    p.classList.toggle('aus', zustand === 'aus');
    if (titel) p.title = titel;
  }

  // ---------- Google-Skript ----------
  async function api(action, daten = {}) {
    if (!cfg.url) throw new Error('Noch nicht mit Google verbunden – bitte in den Einstellungen (⚙) eintragen.');
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
    if (!cfg.url) { pille('#pilleGoogle', 'aus', 'Google-Skript nicht eingetragen'); return; }
    z.laedt = true;
    $('#knopfNeuLaden').classList.add('drehen');
    if (!still && !z.heute) zeichnen();
    try {
      z.heute = await api('heute', { arbeitsbeginn: cfg.beginn, arbeitsende: cfg.ende });
      pille('#pilleGoogle', 'an', 'Google-Skript verbunden');
      banner(z.heute.probleme && z.heute.probleme.length ? 'Teilweise nicht geladen: ' + z.heute.probleme.join(' · ') : '');
      try { localStorage.setItem(STAND, JSON.stringify({ zeit: Date.now(), daten: z.heute })); } catch (e) { /* egal */ }
    } catch (err) {
      pille('#pilleGoogle', 'aus', 'Google-Skript nicht erreichbar');
      let alt = null;
      try { alt = JSON.parse(localStorage.getItem(STAND) || 'null'); } catch (e) { alt = null; }
      if (alt && !z.heute) z.heute = alt.daten;
      banner((navigator.onLine ? 'Google-Skript: ' + err.message : 'Sie sind offline.') +
        (alt ? ' Angezeigt wird der Stand von ' + new Date(alt.zeit).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr.' : ''));
    } finally {
      z.laedt = false;
      $('#knopfNeuLaden').classList.remove('drehen');
      zeichnen();
    }
  }

  // ---------- Schublade & Ansichten ----------
  function oeffne(ansicht) {
    z.ansicht = ansicht;
    document.querySelectorAll('#dock button').forEach((b) => b.classList.toggle('aktiv', b.dataset.ansicht === ansicht));
    const schublade = $('#schublade');
    if (ansicht === 'jarvis') { schublade.hidden = true; return; }
    if (ansicht === 'ideen') z.ideen = null;
    schublade.hidden = false;
    $('#schubladeTitel').textContent = TITEL[ansicht] || ansicht;
    zeichnen();
    inhalt.scrollTop = 0;
  }

  function zeichnen() {
    const d = new Date();
    $('#kopfDatum').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    document.dispatchEvent(new CustomEvent('studio:daten')); // Seitenanzeigen auffrischen
    if (z.ansicht === 'jarvis') return;
    const ansichten = { heute: zeigeHeute, aufgaben: zeigeAufgaben, termine: zeigeTermine, ideen: zeigeIdeen, mails: zeigeMails };
    const fn = ansichten[z.ansicht] || (fremdeAnsichten[z.ansicht] && fremdeAnsichten[z.ansicht].zeichnen);
    if (fn) inhalt.innerHTML = fn();
  }

  const LADEN = '<p class="laden">Einen Moment, ich hole die Daten …</p>';
  const OHNE_GOOGLE = '<p class="leer">Noch nicht mit Google verbunden. Tragen Sie Web-App-URL und Studio-Schlüssel in den Einstellungen (⚙) ein.</p>';

  function zeigeHeute() {
    const d = z.heute;
    if (!d) return z.laedt ? LADEN : OHNE_GOOGLE;
    const p = d.plan;
    let h = '';
    const c = d.claude || {};
    if (c.briefing) {
      h += `<section class="karte plan-karte"><p class="oberzeile">Tagesbriefing · ${new Date(c.briefing.erstellt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr</p>
        <p class="text-block">${esc(c.briefing.text)}</p></section>`;
    }
    const a = p.auslastung;
    const fenster = Math.max(1, zeitZuMin_(cfg.ende) - zeitZuMin_(cfg.beginn));
    const tProz = Math.min(100, a.terminMin / fenster * 100);
    const aProz = Math.min(100 - tProz, a.aufgabenMin / fenster * 100);
    h += `<section class="karte ${c.briefing ? '' : 'plan-karte'}">
      <p class="oberzeile">Regel-Planer</p>
      <h2>${esc(p.zusammenfassung)}</h2>
      <p class="motivation">${esc(p.motivation)}</p>
      <div class="auslastung">
        <div class="balken ${a.prozent > 100 ? 'voll' : ''}"><span class="b-termine" style="width:${tProz}%"></span><span class="b-aufgaben" style="width:${aProz}%"></span></div>
        <small>Termine ${dauerText_(a.terminMin)} · Aufgaben ${dauerText_(a.aufgabenMin)} · noch frei ${dauerText_(a.freiMin)} · Auslastung ${a.prozent} %</small>
      </div>
      ${p.hinweise.length ? '<ul class="hinweise">' + p.hinweise.map(hinweisHtml).join('') + '</ul>' : ''}
    </section>`;

    h += '<section class="karte"><h3>Vorgeschlagene Reihenfolge</h3>';
    if (p.ganztags.length) h += `<div class="chips" style="margin-bottom:8px">${p.ganztags.map((t) => `<span class="chip">Ganztägig: ${esc(t)}</span>`).join('')}</div>`;
    if (!p.reihenfolge.length) {
      h += '<p class="leise">Nichts Festes geplant. Ein guter Moment für eine Aufgabe oder Idee.</p>';
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
          <span ${r.art === 'termin' && r.id ? `data-aktion="termin-oeffnen" data-id="${esc(r.id)}" style="cursor:pointer"` : ''}>
            <span class="titel">${esc(r.titel)}</span>
            <small>${r.art === 'termin' ? 'Termin bis ' + minZuZeit_(r.endeMin) + (r.ort ? ' · ' + esc(r.ort) : '') : 'Vorschlag · ' + dauerText_(r.endeMin - r.startMin)}${istNaechster ? ' · als Nächstes' : ''}</small>
          </span>
          <span class="zeile-knoepfe">${knoepfe}</span></li>`;
      }).join('') + '</ul>';
    }
    if (p.nichtEingeplant.length) h += `<p class="leise" style="margin-top:10px">Passt heute nicht mehr hinein: ${p.nichtEingeplant.map(esc).join(', ')}</p>`;
    h += '</section>';

    const wichtig = d.mails.filter((m) => m.wichtig);
    if (wichtig.length) {
      h += `<section class="karte"><h3>Wichtige Mails <button class="knopf klein" data-aktion="ansicht" data-ziel="mails">Alle ${d.mails.length}</button></h3>
        <ul class="liste">${wichtig.slice(0, 3).map(mailHtml).join('')}</ul></section>`;
    }
    return h;
  }

  function hinweisHtml(h) {
    const icon = { warnung: '⚠', konflikt: '⛔', tipp: '✦', lob: '✓' }[h.art] || '•';
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
    if (!z.heute) return z.laedt ? LADEN : OHNE_GOOGLE;
    const heute = heuteIso();
    const { offen, erledigtHeute } = aufgabenDaten();
    const nachPrio = (a, b) => a.prio - b.prio || a.titel.localeCompare(b.titel);
    const gruppen = [
      ['Überfällig', offen.filter((a) => a.faellig && a.faellig < heute).sort((a, b) => a.faellig.localeCompare(b.faellig)), 'rot'],
      ['Heute', offen.filter((a) => a.faellig === heute).sort(nachPrio)],
      ['Demnächst', offen.filter((a) => a.faellig && a.faellig > heute).sort((a, b) => a.faellig.localeCompare(b.faellig) || nachPrio(a, b))],
      ['Ohne Datum', offen.filter((a) => !a.faellig).sort(nachPrio)],
      ['Heute erledigt', erledigtHeute]
    ];
    let h = `<div class="knopf-reihe" style="justify-content:space-between;margin-top:0"><span class="leise">${offen.length} offen · ${erledigtHeute.length} heute erledigt</span>
      <button class="knopf klein haupt-knopf" data-aktion="aufgabe-neu">＋ Aufgabe</button></div>`;
    let leer = true;
    gruppen.forEach(([titel, liste, klasse]) => {
      if (!liste.length) return;
      leer = false;
      h += `<p class="gruppe-titel ${klasse || ''}">${titel} (${liste.length})</p><ul class="liste">${liste.map(aufgabeHtml).join('')}</ul>`;
    });
    if (leer) h += '<p class="leer">Keine offenen Aufgaben. Ein seltener, aber verdienter Zustand.</p>';
    h += '<p class="leise" style="margin-top:14px">Ihre Aufgaben liegen in Google Tasks – sichtbar auch in Gmail, im Google Kalender und in der Tasks-App.</p>';
    return h;
  }

  function zeigeTermine() {
    const d = z.termineDatum;
    let h = `<div class="datum-navi">
      <button class="knopf" data-aktion="tag" data-tage="-1" aria-label="Vorheriger Tag">◀</button>
      <strong>${esc(datumLang(d))}${d === heuteIso() ? ' · heute' : ''}</strong>
      <button class="knopf" data-aktion="tag" data-tage="1" aria-label="Nächster Tag">▶</button>
    </div>
    <div class="knopf-reihe" style="margin-top:0;justify-content:space-between">
      <button class="knopf klein" data-aktion="tag" data-tage="0">Heute</button>
      <button class="knopf klein haupt-knopf" data-aktion="termin-neu">＋ Termin</button>
    </div>`;
    if (!cfg.url) return h + OHNE_GOOGLE;
    if (!z.termine) { terminLaden(); return h + LADEN; }
    if (!z.termine.length) return h + '<p class="leer">Keine Termine an diesem Tag.</p>';
    h += '<ul class="liste" style="margin-top:12px">' + z.termine.map((t) => `<li>
      <button class="haupt" data-aktion="termin-oeffnen" data-id="${esc(t.id)}">
        <span class="titel">${esc(t.titel)}</span>
        <span class="chips"><span class="chip gruen">${t.ganztags ? 'ganztägig' : esc(t.start + '–' + t.ende)}</span>${t.kalender && !t.hauptkalender ? `<span class="chip">${esc(t.kalender)}</span>` : ''}${t.ort ? `<span class="chip">${esc(t.ort)}</span>` : ''}${t.serie ? '<span class="chip">Serie</span>' : ''}${t.nurLesen ? '<span class="chip">nur lesen</span>' : ''}</span>
      </button></li>`).join('') + '</ul>';
    h += '<p class="leise" style="margin-top:14px">Ändern oder Löschen erfolgt nur nach Ihrer Bestätigung.</p>';
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
    if (!cfg.url) return OHNE_GOOGLE;
    if (!z.ideen) { ideenLaden(); return LADEN; }
    let h = '<p class="leise">Ihr Ideen- und Erinnerungsspeicher. Sagen Sie MO einfach „Idee: …“.</p>';
    if (!z.ideen.length) return h + '<p class="leer">Noch keine Ideen gespeichert.</p>';
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
    if (!z.heute) return z.laedt ? LADEN : OHNE_GOOGLE;
    const m = z.heute.mails;
    let h = `<div class="knopf-reihe" style="margin-top:0;justify-content:space-between;align-items:center">
      <span class="leise">Ungelesen, letzte 3 Tage, ohne Werbung</span><button class="knopf klein" data-aktion="mails-neu">⟳ Neu laden</button></div>`;
    h += '<p class="leise">Nur Lesezugriff. Geantwortet wird in Gmail – hier wird nie etwas gesendet oder gelöscht.</p>';
    if (!m.length) return h + '<p class="leer">Posteingang ruhig. Keine ungelesenen Mails.</p>';
    return h + '<ul class="liste">' + m.map(mailHtml).join('') + '</ul>';
  }

  // ---------- Dialoge ----------
  function dialogOeffnen(html) {
    return new Promise((resolve) => {
      dlgForm.innerHTML = html;
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve({ wert: dlg.returnValue, daten: Object.fromEntries(new FormData(dlgForm)) }), { once: true });
      dlg.showModal();
      const erstes = dlgForm.querySelector('input:not([type=hidden]):not([type=checkbox]),textarea');
      if (erstes && !('ontouchstart' in window)) erstes.focus();
    });
  }

  async function bestaetigen(titel, textHtml, jaText = 'Ja', gefahr = false) {
    const r = await dialogOeffnen(`<h2>${esc(titel)}</h2><div>${textHtml}</div>
      <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start"><button class="knopf ${gefahr ? 'gefahr' : 'haupt-knopf'}" value="ja">${esc(jaText)}</button>
      <button class="knopf" value="nein" formnovalidate>Abbrechen</button></div>`);
    return r.wert === 'ja';
  }

  const DAUERN = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
  /** Auswahl der deutschen Stimmen dieses Geräts (natürliche zuerst) */
  function stimmenOptionen(gewaehlt) {
    const tts = window.speechSynthesis;
    const de = tts ? tts.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang)) : [];
    const rang = (v) => (/natural|neural/i.test(v.name) ? 0 : /premium|enhanced|erweitert/i.test(v.name) ? 1 : /google/i.test(v.name) ? 2 : 3);
    return `<option value="">Automatisch – MOs Stimme über die Zentrale, sonst beste Browser-Stimme</option>` + de.slice().sort((a, b) => rang(a) - rang(b)).map((v) =>
      `<option value="${esc(v.name)}" ${v.name === gewaehlt ? 'selected' : ''}>${esc(v.name)}${rang(v) === 0 ? ' ★ natürlich' : ''}</option>`).join('');
  }

  const KNOEPFE = (haupt, loeschen) => `<div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start">
      <button class="knopf haupt-knopf" value="speichern">${haupt}</button>
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      ${loeschen ? `<button class="knopf gefahr" value="loeschen" formnovalidate style="margin-right:auto">${loeschen}</button>` : ''}
    </div>`;

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
      ${KNOEPFE('Speichern', neu ? '' : 'Löschen')}`);
    if (r.wert === 'speichern') {
      const daten = { titel: r.daten.titel.trim(), notizen: r.daten.notizen, faellig: r.daten.faellig || '', prio: Number(r.daten.prio), dauer: Number(r.daten.dauer) };
      await ausfuehren(neu ? 'aufgabe.neu' : 'aufgabe.aendern', neu ? daten : Object.assign({ id: a.id }, daten), neu ? 'Aufgabe gespeichert.' : 'Aufgabe aktualisiert.');
    } else if (r.wert === 'loeschen') {
      if (await bestaetigen('Aufgabe löschen?', `„${esc(a.titel)}“ wird aus Google Tasks entfernt.`, 'Löschen', true)) {
        await ausfuehren('aufgabe.loeschen', { id: a.id }, 'Aufgabe gelöscht.');
      }
    }
  }

  function terminText(t) {
    if (!t) return '';
    return `${esc(datumKurz(t.datum))}${t.ganztags || !t.start ? ' · ganztägig' : ' · ' + esc(t.start) + '–' + esc(t.ende)}${t.ort ? ' · ' + esc(t.ort) : ''}`;
  }

  async function terminDialog(t, vorschlag) {
    // Termine aus Kalendern, die Sie nur lesen dürfen: anzeigen, aber nicht bearbeiten
    if (t && t.nurLesen) {
      await dialogOeffnen(`<h2>${esc(t.titel)}</h2>
        <p>${terminText(t)}</p>
        ${t.ort ? `<p class="leise">Ort: ${esc(t.ort)}</p>` : ''}
        ${t.notizen ? `<p class="leise">${esc(t.notizen).slice(0, 600)}</p>` : ''}
        <p class="leise">Kalender „${esc(t.kalender || '')}“ – für Sie nur lesbar, deshalb hier nicht änderbar.</p>
        ${t.link ? `<p class="leise"><a href="${esc(t.link)}" target="_blank" rel="noopener">In Google Kalender öffnen</a></p>` : ''}
        <div class="knopf-reihe"><button class="knopf" value="abbrechen" formnovalidate>Schließen</button></div>`);
      return;
    }
    const neu = !t;
    const v = t || {
      titel: (vorschlag && vorschlag.titel) || '', datum: (vorschlag && vorschlag.datum) || z.termineDatum,
      start: (vorschlag && vorschlag.zeit) || '', ende: (vorschlag && vorschlag.endeZeit) || '', ganztags: !!(vorschlag && !vorschlag.zeit), ort: '', notizen: ''
    };
    const r = await dialogOeffnen(`<h2>${neu ? 'Neuer Termin' : 'Termin bearbeiten'}</h2>
      ${vorschlag ? '<p class="leise">So habe ich Sie verstanden. Bitte kurz prüfen.</p>' : ''}
      <label class="feld"><span>Titel</span><input name="titel" required value="${esc(v.titel)}"></label>
      <label class="feld"><span>Datum</span><input type="date" name="datum" required value="${esc(v.datum)}"></label>
      <label class="check"><input type="checkbox" name="ganztags" ${v.ganztags ? 'checked' : ''}> ganztägig</label>
      <div class="feld-reihe">
        <label class="feld"><span>Beginn</span><input type="time" name="start" value="${esc(v.start || '')}"></label>
        <label class="feld"><span>Ende</span><input type="time" name="ende" value="${esc(v.ende || '')}"></label>
      </div>
      <label class="feld"><span>Ort</span><input name="ort" value="${esc(v.ort)}"></label>
      <label class="feld"><span>Notizen</span><textarea name="notizen">${esc(v.notizen)}</textarea></label>
      ${t && t.serie ? '<p class="leise">Teil einer Serie – Änderungen betreffen nur diesen einen Termin.</p>' : ''}
      ${t && t.link ? `<p class="leise"><a href="${esc(t.link)}" target="_blank" rel="noopener">In Google Kalender öffnen</a></p>` : ''}
      ${KNOEPFE(neu ? 'Eintragen' : 'Änderung prüfen', neu ? '' : 'Löschen …')}`);

    if (r.wert === 'speichern') {
      const ganztags = r.daten.ganztags === 'on' || !r.daten.start;
      const daten = { titel: r.daten.titel.trim(), datum: r.daten.datum, start: ganztags ? '' : r.daten.start, ende: ganztags ? '' : (r.daten.ende || ''), ort: r.daten.ort, notizen: r.daten.notizen };
      if (!ganztags && daten.ende && daten.ende <= daten.start) { toast('Das Ende muss nach dem Beginn liegen.'); return terminDialog(t, vorschlag); }
      if (neu) {
        await ausfuehren('termin.neu', daten, 'Termin eingetragen.');
      } else {
        const nachher = { datum: daten.datum, ganztags, start: daten.start, ende: daten.ende || '(automatisch +1 Std.)', ort: daten.ort };
        const ok = await bestaetigen('Termin wirklich ändern?', `<div class="vergleich">
          <div><b>${esc(t.titel)}</b></div><div>Vorher: ${terminText(t)}</div>
          <div>Nachher: <b>${esc(daten.titel)}</b> · ${terminText(nachher)}</div></div>
          <p class="leise">Die Änderung wird direkt in Ihrem Google Kalender gespeichert.</p>`, 'Ja, ändern');
        if (ok) await ausfuehren('termin.aendern', Object.assign({ id: t.id, bestaetigt: true }, daten), 'Termin geändert.');
        else toast('Nichts geändert.');
      }
    } else if (r.wert === 'loeschen') {
      const ok = await bestaetigen('Termin löschen?', `<div class="vergleich"><b>${esc(t.titel)}</b><br>${terminText(t)}</div>
        <p>Der Termin wird aus Ihrem Google Kalender gelöscht. Das lässt sich nicht rückgängig machen.</p>`, 'Endgültig löschen', true);
      if (ok) await ausfuehren('termin.loeschen', { id: t.id, bestaetigt: true }, 'Termin gelöscht.');
      else toast('Nichts gelöscht.');
    }
  }

  async function einstellungenDialog(erstStart) {
    const r = await dialogOeffnen(`<h2>${erstStart ? 'Anmelden' : 'Anmeldung & Einstellungen'}</h2>
      <p class="leise">Es gibt kein Passwort. Sie „melden sich an“, indem Sie dieses Gerät einmal mit zwei Schlüsseln koppeln. Sie bleiben nur auf diesem Gerät gespeichert.</p>
      <p class="abschnitt">Google-Skript (Aufgaben, Termine, Mails)</p>
      <label class="feld"><span>Web-App-URL (endet auf /exec)</span><input name="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url === 'demo' ? '' : cfg.url)}"></label>
      <label class="feld"><span>Studio-Schlüssel</span><input name="schluessel" type="password" autocomplete="off" value="${esc(cfg.schluessel)}"></label>
      <p class="hilfe">Beides finden Sie auf script.google.com in Ihrem Projekt: URL unter „Bereitstellen → Bereitstellungen verwalten“, Schlüssel unter „Projekteinstellungen → Skripteigenschaften“ (STUDIO_SCHLUESSEL).</p>
      <p class="abschnitt">Zentrale auf dem Laptop (MO & Claude)</p>
      <label class="feld"><span>Zentrale-Adresse (https://…ts.net)</span><input name="zentrale" inputmode="url" placeholder="https://ihr-laptop.tailxxxx.ts.net" value="${esc(cfg.zentrale === 'demo' ? '' : cfg.zentrale)}"></label>
      <label class="feld"><span>Kopplungsschlüssel der Zentrale</span><input name="zentraleSchluessel" type="password" autocomplete="off" value="${esc(cfg.zentraleSchluessel)}"></label>
      <p class="hilfe">Optional – nur für MO und Claude-Aufgaben. Adresse: zeigt <b>tailscale-einrichten.cmd</b> an. Schlüssel: im Ordner <i>zentrale</i> den Befehl <code>node zentrale.mjs --schluessel</code> ausführen.</p>
      <p class="abschnitt">Sprache</p>
      <label class="check"><input type="checkbox" name="aufJarvisHoeren" ${cfg.aufJarvisHoeren ? 'checked' : ''}> Auf das Rufwort „Hey MO“ oder „Hey Jarvis“ hören, solange das Studio geöffnet ist</label>
      <p class="hilfe">„Hey MO“ (oder „Hey Jarvis“) startet ein Gespräch. Danach reden Sie einfach weiter – ohne Rufwort. Es endet mit „Danke, das war's“ oder wenn eine Weile niemand spricht.</p>
      <div class="feld-reihe" style="align-items:flex-end">
        <label class="feld" style="flex:1"><span>Stimme von MO</span><select name="stimmeName">${stimmenOptionen(cfg.stimmeName)}</select></label>
        <button type="button" class="knopf klein" data-stimme-probe style="margin-bottom:12px">▶ Probe</button>
      </div>
      <p class="hilfe">Am natürlichsten klingen Stimmen mit „Natural“ im Namen (im Browser Microsoft Edge) und „Premium“ auf dem iPhone (Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen).</p>
      <p class="hilfe">Dafür lauscht der Browser dauerhaft; die Spracherkennung läuft über Google (Chrome) bzw. Apple (Safari). Auf dem Handy nur, solange der Bildschirm an und das Studio im Vordergrund ist.</p>
      <p class="abschnitt">Arbeitszeit</p>
      <div class="feld-reihe">
        <label class="feld"><span>Beginn</span><input type="time" name="beginn" value="${esc(cfg.beginn)}"></label>
        <label class="feld"><span>Ende</span><input type="time" name="ende" value="${esc(cfg.ende)}"></label>
      </div>
      <p class="leise">Alle Schlüssel bleiben ausschließlich auf diesem Gerät gespeichert.</p>
      <div class="knopf-reihe" style="flex-direction:row-reverse;justify-content:flex-start">
        <button class="knopf haupt-knopf" value="speichern" formnovalidate>Anmelden & testen</button>
        <button class="knopf" value="demo" formnovalidate>Demo ansehen</button>
        ${erstStart ? '' : '<button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>'}
      </div>`);
    if (r.wert === 'demo') {
      Object.assign(cfg, { url: 'demo', zentrale: 'demo' }); einstellungenSpeichern();
      z.heute = null; z.ideen = null; z.termine = null;
      toast('Demo-Modus: nur Beispieldaten, nichts wird gespeichert.');
      heuteLaden();
      if (window.Jarvis) Jarvis.neuVerbinden();
      return;
    }
    if (r.wert !== 'speichern') { if (erstStart && !cfg.url) einstellungenDialog(true); return; }
    const url = (r.daten.url || '').trim();
    if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
      toast('Die Google-URL beginnt mit https://script.google.com/macros/s/ und endet auf /exec.', 6000);
      return einstellungenDialog(erstStart);
    }
    const zentrale = (r.daten.zentrale || '').trim().replace(/\/+$/, '');
    if (zentrale && !/^https:\/\/[^/]+$/.test(zentrale) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(zentrale)) {
      toast('Die Zentrale-Adresse beginnt mit https:// und enthält keinen Pfad (z. B. https://laptop.tailxxxx.ts.net).', 6000);
      return einstellungenDialog(erstStart);
    }
    Object.assign(cfg, {
      url, schluessel: (r.daten.schluessel || '').trim(), zentrale, zentraleSchluessel: (r.daten.zentraleSchluessel || '').trim(),
      beginn: r.daten.beginn || '08:00', ende: r.daten.ende || '18:00', aufJarvisHoeren: r.daten.aufJarvisHoeren === 'on', stimmeName: r.daten.stimmeName || ''
    });
    if (window.Jarvis) Jarvis.rufwortAnwenden();
    einstellungenSpeichern();
    z.heute = null; z.ideen = null; z.termine = null;
    if (url) {
      try { await api('ping'); toast('Google-Skript verbunden.'); } catch (err) { toast('Google-Skript: ' + err.message, 7000); }
      heuteLaden();
    }
    if (window.Jarvis) Jarvis.neuVerbinden();
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

  /** Notiz ohne Zentrale: direkt ans Google-Skript (Text wird dort verstanden). */
  async function schnellNotieren(text, typ) {
    const r = await api('schnell', { text, typ });
    if (r.typ === 'termin') { terminDialog(null, r.verstanden); return 'Ich habe den Termin vorbereitet – bitte kurz prüfen.'; }
    if (r.typ === 'idee') { z.ideen = null; return 'Idee notiert: „' + r.eintrag.text + '“.'; }
    heuteLaden(true);
    const a = r.eintrag;
    return 'Aufgabe notiert: „' + a.titel + '“' + (a.faellig ? ', fällig ' + datumKurz(a.faellig) : '') + (a.prio === 1 ? ', wichtig' : '') + '.';
  }

  function findeAufgabe(id) { const d = aufgabenDaten(); return d.offen.concat(d.erledigtHeute).find((a) => a.id === id); }
  function findeTermin(id) { return (z.termine || []).concat((z.heute && z.heute.termine) || []).find((t) => t.id === id); }

  inhalt.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-aktion]');
    if (!el) return;
    const { aktion, id } = el.dataset;
    switch (aktion) {
      case 'haken': {
        el.classList.add('an'); el.textContent = '✓';
        const a = findeAufgabe(id);
        await ausfuehren('aufgabe.erledigt', { id, erledigt: true }, '✓ ' + (a ? a.titel : 'Erledigt') + ' – ausgezeichnet.');
        break;
      }
      case 'zurueck': await ausfuehren('aufgabe.erledigt', { id, erledigt: false }, 'Wieder offen.'); break;
      case 'aufgabe-oeffnen': aufgabeDialog(findeAufgabe(id)); break;
      case 'aufgabe-neu': aufgabeDialog(null); break;
      case 'termin-oeffnen': { const t = findeTermin(id); if (t) terminDialog(t); break; }
      case 'termin-neu': terminDialog(null); break;
      case 'tag': {
        const n = Number(el.dataset.tage);
        z.termineDatum = n === 0 ? heuteIso() : datumPlusTage_(z.termineDatum, n);
        z.termine = null; zeichnen(); break;
      }
      case 'ansicht': oeffne(el.dataset.ziel); break;
      case 'blocken': {
        const start = minZuZeit_(Number(el.dataset.start)), ende = minZuZeit_(Number(el.dataset.ende));
        const ok = await bestaetigen('Zeitblock eintragen?', `Ich trage <b>„${esc(el.dataset.titel)}“</b> heute von ${start} bis ${ende} Uhr in Ihren Google Kalender ein – Ihre Apple Watch erinnert Sie dann daran.`, 'Eintragen');
        if (ok) await ausfuehren('termin.neu', { titel: '✓ ' + el.dataset.titel, datum: heuteIso(), start, ende, notizen: 'Zeitblock aus dem Todo Studio', erinnerungMin: 5 }, 'Zeitblock eingetragen.');
        break;
      }
      case 'schieben': {
        const ids = el.dataset.ids.split(',').filter(Boolean);
        const titel = ids.map((i) => (findeAufgabe(i) || {}).titel).filter(Boolean);
        const ok = await bestaetigen('Auf morgen verschieben?', 'Neues Fälligkeitsdatum morgen für: ' + titel.map((t) => `„${esc(t)}“`).join(', '), 'Verschieben');
        if (ok) {
          const morgen = datumPlusTage_(heuteIso(), 1);
          for (const i of ids) await api('aufgabe.aendern', { id: i, faellig: morgen }).catch((err) => toast(err.message));
          toast('Verschoben. Der Tag hat wieder Luft.');
          heuteLaden(true);
        }
        break;
      }
      case 'idee-aufgabe': await ausfuehren('idee.zuAufgabe', { id }, 'Aus der Idee wird eine Aufgabe.'); break;
      case 'idee-bearbeiten': {
        const i = (z.ideen || []).find((x) => x.id === id);
        const r = await dialogOeffnen(`<h2>Idee bearbeiten</h2><label class="feld"><span>Idee</span><textarea name="text" required>${esc(i.text)}</textarea></label>${KNOEPFE('Speichern')}`);
        if (r.wert === 'speichern') await ausfuehren('idee.aendern', { id, text: r.daten.text.trim() }, 'Gespeichert.');
        break;
      }
      case 'idee-loeschen': {
        const i = (z.ideen || []).find((x) => x.id === id);
        if (await bestaetigen('Idee löschen?', `„${esc(i ? i.text : '')}“`, 'Löschen', true)) await ausfuehren('idee.loeschen', { id }, 'Idee gelöscht.');
        break;
      }
      case 'mail-aufgabe': await ausfuehren('mail.zuAufgabe', { id }, 'Mail als Aufgabe für heute notiert.'); break;
      case 'mails-neu':
        try { z.heute.mails = await api('mails.liste', { frisch: true }); zeichnen(); } catch (err) { toast(err.message); }
        break;
      default:
        if (fremdeAnsichten[z.ansicht] && fremdeAnsichten[z.ansicht].klick) fremdeAnsichten[z.ansicht].klick(el, ev);
    }
  });

  $('#dock').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-ansicht]');
    if (b) oeffne(b.dataset.ansicht);
  });
  $('#knopfSchliessen').addEventListener('click', () => oeffne('jarvis'));
  $('#knopfNeuLaden').addEventListener('click', () => { z.termine = null; z.ideen = null; heuteLaden(); if (window.Jarvis) Jarvis.neuVerbinden(); });
  $('#knopfEinstellungen').addEventListener('click', () => einstellungenDialog(false));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !dlg.open && z.ansicht !== 'jarvis') oeffne('jarvis'); });

  setInterval(() => { if (document.visibilityState === 'visible' && cfg.url) heuteLaden(true); }, 5 * 60 * 1000);

  return {
    get cfg() { return cfg; }, z, api, toast, banner, esc, pille, dialogOeffnen, bestaetigen, heuteLaden, zeichnen, oeffne,
    einstellungenSpeichern, einstellungenDialog, schnellNotieren, datumKurz, heuteIso,
    ansichtRegistrieren(name, def) { fremdeAnsichten[name] = def; }
  };
})();

window.Studio = Studio;

// Start
Studio.zeichnen();
if (Studio.cfg.url) Studio.heuteLaden(); else Studio.einstellungenDialog(true);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Neue Version auf GitHub? Beim Zurückkehren und alle 10 Minuten nachsehen – offene Fenster bleiben sonst auf altem Stand
    const pruefen = () => reg.update().catch(() => { /* offline */ });
    setInterval(pruefen, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pruefen(); });
  }).catch(() => { /* ohne Offline-Hülle weiter */ });
  let hatteVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteVersion) { hatteVersion = true; return; } // allererste Installation: nichts neu laden
    const neuLaden = () => { if (!document.getElementById('eingabeText').value.trim()) location.reload(); };
    if (document.hidden) document.addEventListener('visibilitychange', neuLaden, { once: true });
    else { Studio.toast('Neue Version des Studios – wird geladen …', 2000); setTimeout(neuLaden, 1500); }
  });
}
