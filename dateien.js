/* Todo Studio – Notizen (Ideen + Mentor-Notizen) und Datei-Upload für MO.
   Ansicht „Notizen“ im Dock mit zwei Reitern: Notizen und Dateien. Hochladen geht außerdem über 📎 im Chat
   und per Ziehen & Ablegen aufs Fenster (Laptop). Alles läuft über die Zentrale mit dem Kopplungsschlüssel. */
'use strict';

const Ablage = (() => {
  const $ = (s) => document.querySelector(s);
  const { esc, toast } = Studio;
  const ENDUNGEN = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'txt', 'md', 'csv', 'json'];
  const z = {
    reiter: 'notizen', filter: 'alle',
    notizen: null, notizenLaedt: false, notizenFehler: '',
    dateien: null, dateienLaedt: false, dateienFehler: '', maxMB: 20, ordner: '',
    upload: null, // { name, prozent, status: 'laeuft' | 'ok' | 'fehler', text }
    entwurf: ''   // angefangene Notiz – übersteht das automatische Neuzeichnen
  };

  // ---------- Zentrale ----------
  function zentraleBereit() { const c = Studio.cfg; return !!(c.zentrale && (c.zentrale === 'demo' || c.zentraleSchluessel)); }

  async function zentrale(methode, pfad, body) {
    const c = Studio.cfg;
    if (c.zentrale === 'demo') return DemoZentrale.aufruf(methode, pfad, body);
    const res = await fetch(c.zentrale + pfad, {
      method: methode,
      headers: { Authorization: 'Bearer ' + c.zentraleSchluessel, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    let r;
    try { r = await res.json(); } catch (e) { throw new Error('Zentrale antwortet unerwartet (HTTP ' + res.status + ').'); }
    if (!r.ok) throw new Error(r.fehler || 'Fehler der Zentrale');
    return r.daten;
  }

  function netzFehler(err) {
    return err && (err.name === 'TimeoutError' || err instanceof TypeError) ? 'Zentrale nicht erreichbar.' : (err && err.message) || 'Unbekannter Fehler';
  }

  // ---------- Hilfen ----------
  function datumText(iso) {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return iso;
    const tag = Studio.datumKurz(Studio.heuteIso(d));
    return iso.length > 10 ? tag + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : tag;
  }
  function zeitWert(iso) { const t = Date.parse(iso && iso.length === 10 ? iso + 'T12:00:00' : iso); return isNaN(t) ? 0 : t; }
  function groesseText(b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function sichtbar() { return Studio.z.ansicht === 'notizen'; }
  function neuZeichnen() { if (sichtbar()) Studio.zeichnen(); }

  // ---------- Laden ----------
  async function notizenLaden() {
    if (z.notizenLaedt) return;
    z.notizenLaedt = true; z.notizenFehler = '';
    try {
      if (zentraleBereit()) {
        z.notizen = await zentrale('GET', '/api/notizen');
      } else {
        // Ohne Zentrale: nur die Ideen direkt aus Google (Mentor-Notizen liegen in der Zentrale)
        const ideen = await Studio.api('ideen.liste');
        z.notizen = { ideen: (ideen || []).map((i) => ({ art: 'idee', id: i.id, text: i.text, zeit: i.erstellt || '' })), mentor: [], ideenFehler: '', ohneZentrale: true };
      }
    } catch (err) {
      z.notizenFehler = netzFehler(err);
      if (!z.notizen) z.notizen = { ideen: [], mentor: [], ideenFehler: '' };
    } finally { z.notizenLaedt = false; neuZeichnen(); }
  }

  async function dateienLaden() {
    if (z.dateienLaedt || !zentraleBereit()) return;
    z.dateienLaedt = true; z.dateienFehler = '';
    try {
      const r = await zentrale('GET', '/api/uploads');
      z.dateien = r.dateien || []; z.maxMB = r.maxMB || 20; z.ordner = r.ordner || '';
    } catch (err) {
      z.dateienFehler = netzFehler(err);
      if (!z.dateien) z.dateien = [];
    } finally { z.dateienLaedt = false; neuZeichnen(); }
  }

  // ---------- Hochladen ----------
  function endungVon(name) { const m = /\.([A-Za-z0-9]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }

  function uploadZeigen() {
    const u = z.upload;
    const hinweis = $('#eingabeHinweis');
    if (hinweis) {
      if (u && u.status === 'laeuft') { hinweis.hidden = false; hinweis.textContent = `📎 „${u.name}“ wird hochgeladen … ${u.prozent}%`; }
      else if (u && u.status === 'ok') { hinweis.hidden = false; hinweis.textContent = `📎 „${u.name}“ ist bei MO. Fragen Sie z. B. „Fass die Datei zusammen“.`; }
      else if (u && u.status === 'fehler') { hinweis.hidden = false; hinweis.textContent = `📎 Upload fehlgeschlagen: ${u.text}`; }
      else if (hinweis.textContent.startsWith('📎')) { hinweis.hidden = true; hinweis.textContent = ''; }
    }
    const box = document.getElementById('uploadStatus');
    if (box) box.outerHTML = uploadStatusHtml();
    const knopf = $('#knopfDatei');
    if (knopf) knopf.classList.toggle('laedt', !!(u && u.status === 'laeuft'));
  }

  function uploadStatusHtml() {
    const u = z.upload;
    if (!u) return '<div id="uploadStatus" hidden></div>';
    const klasse = u.status === 'ok' ? 'ok' : u.status === 'fehler' ? 'fehler' : '';
    const text = u.status === 'laeuft' ? `Wird hochgeladen … ${u.prozent}%` : u.status === 'ok' ? 'Hochgeladen.' + (u.text ? ' ' + u.text : '') : 'Fehler: ' + u.text;
    return `<div id="uploadStatus" class="upload-status ${klasse}" role="status">
      <div class="upload-zeile"><b>${esc(u.name)}</b><span>${esc(text)}</span></div>
      <div class="upload-balken"><i style="width:${u.status === 'fehler' ? 100 : u.prozent}%"></i></div></div>`;
  }

  function senden(datei, onFortschritt) {
    const c = Studio.cfg;
    if (c.zentrale === 'demo') {
      return new Promise((ok) => {
        let p = 0;
        const t = setInterval(() => { p = Math.min(100, p + 25); onFortschritt(p); if (p >= 100) { clearInterval(t); ok(DemoZentrale.aufruf('POST', '/api/uploads', { name: datei.name, groesse: datei.size, typ: datei.type })); } }, 200);
      });
    }
    return new Promise((ok, nein) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', c.zentrale + '/api/uploads?name=' + encodeURIComponent(datei.name || 'foto.jpg'));
      xhr.setRequestHeader('Authorization', 'Bearer ' + c.zentraleSchluessel);
      xhr.setRequestHeader('Content-Type', datei.type || 'application/octet-stream');
      xhr.timeout = 10 * 60 * 1000;
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onFortschritt(Math.min(99, Math.round(e.loaded / e.total * 100))); };
      xhr.onload = () => {
        let r = null;
        try { r = JSON.parse(xhr.responseText); } catch (e) { /* unten */ }
        if (r && r.ok) return ok(r.daten);
        if (r && r.fehler) return nein(new Error(r.fehler));
        nein(new Error(xhr.status === 413 ? 'Die Datei ist zu groß.' : 'Zentrale antwortet unerwartet (HTTP ' + xhr.status + ').'));
      };
      xhr.onerror = () => nein(new Error('Zentrale nicht erreichbar.'));
      xhr.ontimeout = () => nein(new Error('Zeitüberschreitung beim Hochladen.'));
      xhr.send(datei);
    });
  }

  async function hochladen(dateien) {
    const liste = Array.from(dateien || []);
    if (!liste.length) return;
    if (!zentraleBereit()) { toast('Zum Hochladen muss die Zentrale verbunden sein (⚙ Einstellungen).', 5000); return; }
    if (z.upload && z.upload.status === 'laeuft') { toast('Bitte warten – es läuft schon ein Upload.'); return; }
    for (const datei of liste) {
      const name = datei.name || 'foto.jpg';
      const endung = endungVon(name) || ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'text/plain': 'txt' })[datei.type] || '';
      if (!ENDUNGEN.includes(endung)) { z.upload = { name, prozent: 0, status: 'fehler', text: 'Dateityp nicht erlaubt (erlaubt: PDF, JPG, PNG, TXT, MD, CSV u. a.).' }; uploadZeigen(); toast(z.upload.text, 5000); continue; }
      if (datei.size > z.maxMB * 1024 * 1024) { z.upload = { name, prozent: 0, status: 'fehler', text: `Zu groß (${groesseText(datei.size)}, höchstens ${z.maxMB} MB).` }; uploadZeigen(); toast(z.upload.text, 5000); continue; }
      if (!datei.size) { z.upload = { name, prozent: 0, status: 'fehler', text: 'Die Datei ist leer.' }; uploadZeigen(); continue; }
      z.upload = { name, prozent: 0, status: 'laeuft', text: '' };
      uploadZeigen();
      try {
        const e = await senden(datei, (p) => { z.upload.prozent = p; uploadZeigen(); });
        const textInfo = e.art === 'bild' ? '' : e.textStatus === 'ok' ? `Text gelesen (${Number(e.textZeichen || 0).toLocaleString('de-DE')} Zeichen).` : (e.textHinweis || '');
        z.upload = { name, prozent: 100, status: 'ok', text: textInfo, id: e.id };
        if (z.dateien) z.dateien = [e].concat(z.dateien.filter((d) => d.id !== e.id)); else dateienLaden();
        toast(`„${name}“ hochgeladen.${textInfo ? ' ' + textInfo : ''}`, 4500);
      } catch (err) {
        z.upload = { name, prozent: 0, status: 'fehler', text: netzFehler(err) };
        toast('Upload fehlgeschlagen: ' + z.upload.text, 6000);
      }
      uploadZeigen();
      neuZeichnen();
    }
    setTimeout(() => { if (z.upload && z.upload.status !== 'laeuft') { z.upload = null; uploadZeigen(); } }, 20000);
  }

  // Dateiauswahl (fest im HTML, damit sie Neuzeichnen übersteht)
  for (const id of ['#dateiWahl', '#fotoWahl']) {
    const el = $(id);
    if (el) el.addEventListener('change', () => { const f = Array.from(el.files || []); el.value = ''; hochladen(f); });
  }

  // 📎 im Chat: per Tastatur bedienbar wie ein Knopf
  const clip = $('#knopfDatei');
  if (clip) clip.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#dateiWahl').click(); } });

  // Laptop: Datei aufs Fenster ziehen
  let ziehZaehler = 0;
  window.addEventListener('dragenter', (e) => { if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return; e.preventDefault(); ziehZaehler++; document.body.classList.add('datei-ziehen'); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  window.addEventListener('dragleave', () => { ziehZaehler = Math.max(0, ziehZaehler - 1); if (!ziehZaehler) document.body.classList.remove('datei-ziehen'); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); ziehZaehler = 0; document.body.classList.remove('datei-ziehen');
    hochladen(e.dataTransfer.files);
  });

  // ---------- Ansicht ----------
  function reiterHtml() {
    const r = [['notizen', 'Notizen'], ['dateien', 'Dateien']];
    return `<div class="reiter">${r.map(([id, t]) => `<button class="${z.reiter === id ? 'aktiv' : ''}" data-n="reiter" data-id="${id}">${t}</button>`).join('')}</div>`;
  }

  function notizenHtml() {
    let h = `<form class="notiz-neu" id="notizNeu" autocomplete="off">
        <label class="feld"><span>Neue Notiz (wird als Idee gespeichert)</span>
          <textarea name="text" id="notizText" rows="3" maxlength="4000" placeholder="Gedanke, Idee, Erinnerung …" enterkeyhint="done">${esc(z.entwurf)}</textarea></label>
        <div class="knopf-reihe" style="margin-top:6px"><button type="submit" class="knopf haupt-knopf" id="notizSpeichern">Speichern</button></div>
      </form>`;
    if (!z.notizen) { notizenLaden(); return h + '<p class="laden">Einen Moment, ich hole Ihre Notizen …</p>'; }
    const n = z.notizen;
    if (z.notizenFehler) h += `<p class="hinweis-zeile fehler">${esc(z.notizenFehler)}</p>`;
    if (n.ideenFehler) h += `<p class="hinweis-zeile">${esc(n.ideenFehler)}</p>`;
    if (n.ohneZentrale) h += '<p class="hinweis-zeile">Zentrale nicht verbunden – Mentor-Notizen werden erst mit der Zentrale angezeigt.</p>';
    const filter = [['alle', 'Alle'], ['idee', `Ideen (${n.ideen.length})`], ['mentor', `Mentor (${n.mentor.length})`]];
    h += `<div class="chips filter-chips">${filter.map(([id, t]) => `<button class="chip-knopf ${z.filter === id ? 'aktiv' : ''}" data-n="filter" data-id="${id}">${t}</button>`).join('')}</div>`;
    const alle = n.ideen.concat(n.mentor).filter((x) => z.filter === 'alle' || x.art === z.filter)
      .sort((a, b) => zeitWert(b.zeit) - zeitWert(a.zeit));
    if (!alle.length) return h + '<p class="leer">Noch keine Notizen. Tippen Sie oben eine ein oder sagen Sie MO „Notiere: …“.</p>';
    h += '<ul class="liste notiz-liste">' + alle.map((x) => `<li>
        <div class="notiz-kopf"><span class="chip ${x.art === 'mentor' ? 'mentor' : ''}">${x.art === 'mentor' ? 'Mentor-Notiz' : 'Idee'}</span><small>${esc(datumText(x.zeit))}</small>
          <button class="knopf klein gefahr" data-n="notiz-loeschen" data-art="${x.art}" data-id="${esc(x.id)}" aria-label="Notiz löschen">Löschen</button></div>
        <span class="titel">${esc(x.text)}</span></li>`).join('') + '</ul>';
    return h;
  }

  function dateienHtml() {
    let h = `<div class="upload-box">
        <div class="upload-knoepfe">
          <label class="knopf haupt-knopf" for="dateiWahl" role="button" tabindex="0">📎 Datei hochladen</label>
          <label class="knopf" for="fotoWahl" role="button" tabindex="0">📷 Foto aufnehmen</label>
        </div>
        <p class="leise klein-text">PDF, Bilder (JPG, PNG) und Text (TXT, MD, CSV) bis ${z.maxMB} MB. MO liest den Text und kann damit arbeiten.</p>
        ${uploadStatusHtml()}
      </div>`;
    if (!zentraleBereit()) return h + '<p class="leer">Zum Hochladen und für die Dateiliste muss die Zentrale verbunden sein (⚙ Einstellungen).</p>';
    if (!z.dateien) { dateienLaden(); return h + '<p class="laden">Einen Moment, ich hole die Dateiliste …</p>'; }
    if (z.dateienFehler) h += `<p class="hinweis-zeile fehler">${esc(z.dateienFehler)}</p>`;
    if (!z.dateien.length) return h + '<p class="leer">Noch keine Dateien hochgeladen.</p>';
    const symbol = { pdf: '📄', bild: '🖼', text: '📝' };
    h += '<ul class="liste datei-liste">' + z.dateien.map((d) => {
      const status = d.art === 'bild' ? '<span class="chip">Bild</span>'
        : d.textStatus === 'ok' ? `<span class="chip ok">Text gelesen</span>` : `<span class="chip warn" title="${esc(d.textHinweis || '')}">kein Text</span>`;
      return `<li>
        <div class="datei-kopf"><span class="datei-symbol" aria-hidden="true">${symbol[d.art] || '📎'}</span>
          <div class="datei-info"><b class="titel">${esc(d.name)}</b><small>${esc(datumText(d.zeit))} · ${groesseText(d.groesse)} · ${status}</small></div></div>
        ${d.auszug ? `<p class="datei-auszug">${esc(d.auszug)}</p>` : ''}
        ${d.textHinweis ? `<p class="datei-auszug leise">${esc(d.textHinweis)}</p>` : ''}
        <div class="zeile-knoepfe"><button class="knopf klein" data-n="mit-mo" data-id="${esc(d.id)}">Mit MO besprechen</button>
          <button class="knopf klein" data-n="pfad" data-id="${esc(d.id)}">Pfad kopieren</button>
          <button class="knopf klein gefahr" data-n="datei-loeschen" data-id="${esc(d.id)}">Löschen</button></div></li>`;
    }).join('') + '</ul>';
    return h;
  }

  function zeichnen() {
    // Tippt der Nutzer gerade, Fokus und Cursor nach dem Neuzeichnen zurückgeben
    const aktiv = document.activeElement && document.activeElement.id === 'notizText' ? document.activeElement : null;
    if (aktiv) {
      const pos = aktiv.selectionStart;
      setTimeout(() => { const t = document.getElementById('notizText'); if (t && t !== aktiv) { t.focus(); t.setSelectionRange(pos, pos); } }, 0);
    }
    return reiterHtml() + (z.reiter === 'dateien' ? dateienHtml() : notizenHtml());
  }

  async function notizSpeichern(form) {
    const feld = form.querySelector('textarea');
    const text = feld.value.trim();
    if (!text) { toast('Bitte zuerst etwas eintippen.'); feld.focus(); return; }
    const knopf = form.querySelector('button[type=submit]');
    knopf.disabled = true; knopf.textContent = 'Speichert …';
    try {
      const r = zentraleBereit() ? await zentrale('POST', '/api/notizen/neu', { text }) : await Studio.api('idee.neu', { text });
      if (!z.notizen) z.notizen = { ideen: [], mentor: [], ideenFehler: '' };
      z.notizen.ideen.unshift({ art: 'idee', id: r.id, text: r.text || text, zeit: r.erstellt || new Date().toISOString() });
      Studio.z.ideen = null; // Ideen-Ansicht beim nächsten Öffnen neu laden
      feld.value = ''; z.entwurf = '';
      toast('Notiz gespeichert.');
      neuZeichnen();
    } catch (err) {
      toast('Nicht gespeichert: ' + netzFehler(err), 6000);
      knopf.disabled = false; knopf.textContent = 'Speichern';
    }
  }

  async function klick(el) {
    const { n: was, id } = el.dataset;
    if (was === 'reiter') { z.reiter = id; if (id === 'dateien') dateienLaden(); else notizenLaden(); Studio.zeichnen(); return; }
    if (was === 'filter') { z.filter = id; Studio.zeichnen(); return; }
    if (was === 'notiz-loeschen') {
      const art = el.dataset.art;
      const liste = z.notizen ? (art === 'mentor' ? z.notizen.mentor : z.notizen.ideen) : [];
      const x = liste.find((q) => q.id === id);
      if (!(await Studio.bestaetigen(art === 'mentor' ? 'Mentor-Notiz löschen?' : 'Idee löschen?', `„${esc(x ? x.text.slice(0, 300) : '')}“<p class="leise">Das lässt sich nicht rückgängig machen.</p>`, 'Löschen', true))) return;
      try {
        if (zentraleBereit()) await zentrale('POST', '/api/notizen/loeschen', { art, id });
        else await Studio.api('idee.loeschen', { id });
        const i = liste.indexOf(x);
        if (i >= 0) liste.splice(i, 1);
        if (art === 'idee') Studio.z.ideen = null;
        toast('Notiz gelöscht.');
        neuZeichnen();
      } catch (err) { toast('Nicht gelöscht: ' + netzFehler(err), 6000); }
      return;
    }
    const d = (z.dateien || []).find((q) => q.id === id);
    if (was === 'datei-loeschen' && d) {
      if (!(await Studio.bestaetigen('Datei löschen?', `„${esc(d.name)}“ und der ausgelesene Text werden vom Server gelöscht. MO kennt die Datei danach nicht mehr.`, 'Löschen', true))) return;
      try {
        await zentrale('POST', '/api/uploads/loeschen', { id });
        z.dateien = z.dateien.filter((q) => q.id !== id);
        toast('Datei gelöscht.');
        neuZeichnen();
      } catch (err) { toast('Nicht gelöscht: ' + netzFehler(err), 6000); }
      return;
    }
    if (was === 'mit-mo' && d) {
      Studio.oeffne('jarvis');
      const eingabe = $('#eingabeText');
      eingabe.value = `Zur Datei „${d.name}“: `;
      if (!document.body.classList.contains('chat-offen')) $('#chatKnopf').click();
      setTimeout(() => { eingabe.focus(); eingabe.setSelectionRange(eingabe.value.length, eingabe.value.length); }, 150);
      return;
    }
    if (was === 'pfad' && d) {
      try { await navigator.clipboard.writeText(d.pfad); toast('Pfad kopiert: ' + d.pfad, 4000); } catch (e) { toast(d.pfad, 6000); }
    }
  }

  // Klicks und Formular in der Schublade (nur, solange die Notizen-Ansicht offen ist)
  const inhalt = $('#inhalt');
  inhalt.addEventListener('click', (ev) => {
    if (!sichtbar()) return;
    const el = ev.target.closest('[data-n]');
    if (el) { ev.preventDefault(); klick(el); }
  });
  inhalt.addEventListener('keydown', (ev) => {
    if (!sichtbar()) return;
    const l = ev.target.closest('label[for]');
    if (l && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); const f = document.getElementById(l.htmlFor); if (f) f.click(); }
    if (ev.target.id === 'notizText' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); notizSpeichern(ev.target.form); }
  });
  inhalt.addEventListener('input', (ev) => { if (ev.target.id === 'notizText') z.entwurf = ev.target.value; });
  inhalt.addEventListener('submit', (ev) => {
    if (!sichtbar() || ev.target.id !== 'notizNeu') return;
    ev.preventDefault();
    notizSpeichern(ev.target);
  });

  // Beim Öffnen frisch laden
  document.querySelector('#dock').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-ansicht="notizen"]');
    if (!b) return;
    z.notizen = null; z.dateien = null;
  }, true);

  Studio.ansichtRegistrieren('notizen', { zeichnen, klick: () => {} });

  return {
    hochladen,
    dateienZeigen() { z.reiter = 'dateien'; z.dateien = null; Studio.oeffne('notizen'); }
  };
})();
window.Ablage = Ablage;
