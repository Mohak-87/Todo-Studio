/* Todo Studio – Google-Diagnose: Warum ist die Google-Anzeige rot?
 * Reine Logik ohne Oberfläche: Schlüssel prüfen (Länge, vertauscht?), Fehler des Google-Skripts
 * einordnen (Zeitüberschreitung, Netzwerk/CORS, Zugang abgelehnt, ungültige Antwort …),
 * Wiederholungen mit wachsendem Abstand und der Google-Stand der Zentrale (Briefkasten-Agent „bote“).
 * Sicherheit: Schlüssel werden nie ausgegeben oder geloggt – höchstens Länge und die letzten 4 Zeichen.
 * Läuft im Browser (window.GoogleDiagnose) und in Node (module.exports) – siehe tests/googlediagnose.test.js. */
'use strict';

const GoogleDiagnose = (() => {
  /** Studio-Schlüssel aus apps-script/Code.gs: zwei UUIDs ohne Bindestriche = 64 Hex-Zeichen. */
  const LAENGE_GOOGLE = 64;
  /** Kopplungsschlüssel der Zentrale (zentrale/lib/konfig.mjs): 32 Zufallsbytes base64url = 43 Zeichen. */
  const LAENGE_KOPPLUNG = 43;
  /** Wartezeiten vor der 1., 2. und 3. Wiederholung – erst danach wird die Anzeige rot. */
  const ABSTAENDE = [2000, 6000, 15000];
  /** Nur vorübergehende Fehler lohnen eine Wiederholung; ein falscher Schlüssel wird nicht richtiger. */
  const WIEDERHOLBAR = ['zeit', 'netz', 'server', 'antwort'];
  const URL_MUSTER = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;

  // ---------- Schlüssel ----------
  /** 'leer' | 'google' (64 Hex) | 'kopplung' (43 base64url) | 'unbekannt' */
  function schluesselArt(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return 'leer';
    if (s.length === LAENGE_GOOGLE && /^[0-9a-f]+$/i.test(s)) return 'google';
    if (s.length === LAENGE_KOPPLUNG && /^[A-Za-z0-9_-]+$/.test(s)) return 'kopplung';
    return 'unbekannt';
  }

  /** Sichere Kurzbeschreibung: nur Länge, ab 16 Zeichen zusätzlich die letzten 4. Nie der Schlüssel selbst. */
  function maskiert(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return 'leer';
    return s.length >= 16 ? `${s.length} Zeichen, endet auf …${s.slice(-4)}` : `${s.length} Zeichen`;
  }

  /** „ (endet auf …ab12)“ ab 16 Zeichen, sonst nichts – für Sätze, die die Länge schon nennen. */
  function ende(s) {
    s = String(s == null ? '' : s).trim();
    return s.length >= 16 ? ` (endet auf …${s.slice(-4)})` : '';
  }

  /**
   * Prüft die Einträge unter ⚙ (cfg aus Studio.cfg: url, schluessel, zentrale, zentraleSchluessel).
   * Ergebnis: { demo, vertauscht, doppelt, schritte: [{ id, ok: true|false|'warn'|null, titel, text }] }
   */
  function schluesselPruefen(cfg) {
    cfg = cfg || {};
    if (cfg.url === 'demo') {
      return { demo: true, vertauscht: false, doppelt: false, schritte: [
        { id: 'demo', ok: null, titel: 'Demo-Modus', text: 'Es werden nur Beispieldaten gezeigt – kein echter Schlüssel, keine echte Google-Verbindung.' }] };
    }
    const schritte = [];
    const url = String(cfg.url || '').trim();
    if (!url) schritte.push({ id: 'url', ok: false, titel: 'Web-App-URL', text: 'Keine Web-App-URL eingetragen. Bitte unter ⚙ die Adresse aus „Bereitstellen → Bereitstellungen verwalten“ eintragen.' });
    else if (!URL_MUSTER.test(url)) schritte.push({ id: 'url', ok: false, titel: 'Web-App-URL', text: 'Die Adresse hat nicht die erwartete Form https://script.google.com/macros/s/…/exec.' });
    else schritte.push({ id: 'url', ok: true, titel: 'Web-App-URL', text: 'Eingetragen und richtig aufgebaut (…/exec).' });

    const g = String(cfg.schluessel || '').trim(), k = String(cfg.zentraleSchluessel || '').trim();
    const ag = schluesselArt(g), ak = schluesselArt(k);
    const doppelt = !!g && g === k;
    const vertauscht = !doppelt && (ag === 'kopplung' || ak === 'google');

    if (ag === 'leer') schritte.push({ id: 'schluessel', ok: false, titel: 'Studio-Schlüssel (Google)', text: 'Kein Schlüssel eingetragen. Ohne ihn lehnt das Google-Skript jede Anfrage ab.' });
    else if (doppelt) schritte.push({ id: 'schluessel', ok: false, titel: 'Studio-Schlüssel (Google)', text: `Im Google-Feld und im Zentrale-Feld steht derselbe Schlüssel (${maskiert(g)}). Einer davon ist falsch.` });
    else if (ag === 'google') schritte.push({ id: 'schluessel', ok: true, titel: 'Studio-Schlüssel (Google)', text: `Eingetragen, ${maskiert(g)} – Länge wie erwartet (${LAENGE_GOOGLE}).` });
    else if (ag === 'kopplung') schritte.push({ id: 'schluessel', ok: false, titel: 'Studio-Schlüssel (Google)', text: `Hier stehen ${LAENGE_KOPPLUNG} Zeichen${ende(g)} – so sieht der Kopplungsschlüssel der Zentrale aus, nicht der Google-Schlüssel (${LAENGE_GOOGLE} Zeichen).` });
    else schritte.push({ id: 'schluessel', ok: 'warn', titel: 'Studio-Schlüssel (Google)', text: `Eingetragen, ${maskiert(g)} – erwartet sind ${LAENGE_GOOGLE}. Das stimmt nur, wenn der Schlüssel im Skript von Hand festgelegt wurde.` });

    if (ak === 'leer') schritte.push({ id: 'kopplung', ok: null, titel: 'Kopplungsschlüssel (Zentrale)', text: 'Nicht eingetragen – nur für MO und Claude nötig, für Google egal.' });
    else if (doppelt) { /* oben schon gemeldet */ }
    else if (ak === 'kopplung') schritte.push({ id: 'kopplung', ok: true, titel: 'Kopplungsschlüssel (Zentrale)', text: `Eingetragen, ${maskiert(k)} – Länge wie erwartet (${LAENGE_KOPPLUNG}).` });
    else if (ak === 'google') schritte.push({ id: 'kopplung', ok: false, titel: 'Kopplungsschlüssel (Zentrale)', text: `Hier stehen ${LAENGE_GOOGLE} Zeichen${ende(k)} – so sieht der Google-Schlüssel aus, nicht der Kopplungsschlüssel (${LAENGE_KOPPLUNG} Zeichen).` });
    else schritte.push({ id: 'kopplung', ok: 'warn', titel: 'Kopplungsschlüssel (Zentrale)', text: `Eingetragen, ${maskiert(k)} – erwartet sind ${LAENGE_KOPPLUNG}.` });

    return { demo: false, vertauscht, doppelt, schritte };
  }

  /** Inhalte von Google-Feld und Zentrale-Feld tauschen (neues Objekt, nur die beiden Schlüssel). */
  function felderGetauscht(cfg) {
    return Object.assign({}, cfg, { schluessel: String(cfg.zentraleSchluessel || '').trim(), zentraleSchluessel: String(cfg.schluessel || '').trim() });
  }

  // ---------- Fehlerarten ----------
  const ART_TEXT = {
    ok: 'Das Google-Skript antwortet.',
    fehlt: 'Keine Web-App-URL eingetragen – es gibt nichts zu prüfen.',
    offline: 'Dieses Gerät ist offline. Sobald es wieder Netz hat, prüft das Studio von selbst neu.',
    zeit: 'Zeitüberschreitung – das Google-Skript hat nicht rechtzeitig geantwortet. Meist vorübergehend.',
    netz: 'Netzwerk/CORS – der Browser kommt nicht bis zum Google-Skript. Ursachen: Verbindung kurz weg, falsche URL oder die Web-App ist nicht für „Jeder“ freigegeben.',
    zugang: 'Zugang abgelehnt – das Skript kennt diesen Studio-Schlüssel nicht. Schlüssel unter ⚙ prüfen.',
    adresse: 'Adresse nicht gefunden – die Web-App-URL stimmt nicht oder die Bereitstellung wurde gelöscht.',
    server: 'Google meldet einen Serverfehler – meist vorübergehend.',
    antwort: 'Ungültige Antwort – keine lesbare Rückmeldung vom Skript. Stimmt die Web-App-URL?',
    skript: 'Das Skript hat geantwortet, aber einen Fehler gemeldet.',
    http: 'Unerwartete Antwort des Servers.'
  };
  const ART_KURZ = { ok: 'verbunden', fehlt: 'nicht eingetragen', offline: 'offline', zeit: 'Zeitüberschreitung', netz: 'Netzwerk/CORS',
    zugang: 'Zugang abgelehnt', adresse: 'Adresse falsch', server: 'Serverfehler', antwort: 'ungültige Antwort', skript: 'Skriptfehler', http: 'unerwarteter Status' };

  /** Klartext zu einer Fehlerart, mit HTTP-Status, falls bekannt. */
  function artText(art, status, meldung) {
    let t = ART_TEXT[art] || ART_TEXT.http;
    if (art === 'skript' && meldung) t = 'Das Skript meldet: ' + meldung;
    if (status && status !== 200 && art !== 'ok') t += ` (Status ${status})`;
    return t;
  }

  /**
   * Ordnet einen Abruf ein. Eingabe: { fehler } bei abgebrochenem fetch, sonst { status, json }
   * (json = null, wenn die Antwort kein JSON war). Ergebnis: { art, status, meldung }.
   */
  function einordnen(e) {
    e = e || {};
    if (e.fehler) {
      const n = e.fehler.name;
      if (e.zeitAbgelaufen || n === 'AbortError' || n === 'TimeoutError') return { art: 'zeit', status: 0, meldung: '' };
      return { art: 'netz', status: 0, meldung: '' }; // TypeError „Failed to fetch“/„Load failed“ – auch bei CORS
    }
    const status = Number(e.status) || 0;
    if (status && (status < 200 || status >= 300)) {
      if (status === 401 || status === 403) return { art: 'zugang', status, meldung: '' };
      if (status === 404) return { art: 'adresse', status, meldung: '' };
      if (status >= 500) return { art: 'server', status, meldung: '' };
      return { art: 'http', status, meldung: '' };
    }
    const j = e.json;
    if (!j || typeof j !== 'object') return { art: 'antwort', status, meldung: '' };
    if (j.ok) return { art: 'ok', status, meldung: '' };
    const m = String(j.fehler || 'Unbekannter Fehler');
    if (/schl(ü|ue)ssel/i.test(m)) return { art: 'zugang', status, meldung: m };
    if (/service (is )?(unavailable|invoked too many)|zu viele|überlastet|timed? ?out/i.test(m)) return { art: 'server', status, meldung: m };
    return { art: 'skript', status, meldung: m };
  }

  function fehlerObjekt(o) {
    const meldung = o.art === 'antwort' ? 'Keine gültige Antwort vom Google-Skript. Stimmt die Web-App-URL?'
      : (o.art === 'zugang' || o.art === 'skript' || o.art === 'server') && o.meldung ? o.meldung
        : artText(o.art, o.status);
    const err = new Error(meldung);
    err.art = o.art; err.status = o.status || 0;
    return err;
  }

  /**
   * Ein Aufruf des Google-Skripts (wie bisher: POST, text/plain, Schlüssel im Rumpf an dieselbe URL).
   * Wirft bei Fehlern ein Error mit .art und .status. timeoutMs optional (0 = ohne Zeitlimit).
   */
  async function skriptAufruf({ url, schluessel, action, daten, timeoutMs, fetch: f }) {
    f = f || (typeof fetch !== 'undefined' ? fetch : null);
    const ctrl = timeoutMs && typeof AbortController !== 'undefined' ? new AbortController() : null;
    let abgelaufen = false, uhr = null;
    if (ctrl) uhr = setTimeout(() => { abgelaufen = true; ctrl.abort(); }, timeoutMs);
    try {
      let res;
      try {
        res = await f(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({}, daten || {}, { action, key: schluessel })),
          signal: ctrl ? ctrl.signal : undefined
        });
      } catch (fehler) { throw fehlerObjekt(einordnen({ fehler, zeitAbgelaufen: abgelaufen })); }
      let json = null;
      try { json = await res.json(); } catch (fehler) {
        if (abgelaufen) throw fehlerObjekt(einordnen({ fehler, zeitAbgelaufen: true }));
        json = null;
      }
      const o = einordnen({ status: res.status, json });
      if (o.art !== 'ok') throw fehlerObjekt(o);
      return json.daten;
    } finally { if (uhr) clearTimeout(uhr); }
  }

  // ---------- Wiederholen ----------
  function sollWiederholen(err) { return !!err && WIEDERHOLBAR.indexOf(err.art) >= 0; }

  /**
   * Führt fn(versuchNr) aus; bei vorübergehenden Fehlern bis zu abstaende.length Wiederholungen
   * mit wachsendem Abstand. beiFehler(err, wiederholungNr, wartezeitMs) meldet jede Wiederholung.
   * Der zuletzt geworfene Fehler bekommt .versuche (Anzahl aller Versuche).
   */
  async function mitWiederholung(fn, o) {
    o = o || {};
    const abstaende = o.abstaende || ABSTAENDE;
    const warte = o.warte || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const soll = o.sollWiederholen || sollWiederholen;
    for (let i = 0; ; i++) {
      try { return await fn(i); } catch (err) {
        if (i >= abstaende.length || !soll(err)) { if (err && typeof err === 'object') err.versuche = i + 1; throw err; }
        if (o.beiFehler) o.beiFehler(err, i + 1, abstaende[i]);
        await warte(abstaende[i]);
      }
    }
  }

  // ---------- Zentrale ----------
  /**
   * Erreicht die Zentrale selbst Google? Abgelesen am Briefkasten-Agenten „bote“ aus /api/zustand,
   * der alle 20 s beim Google-Skript nachfragt. null = nicht prüfbar (keine Zentrale verbunden).
   */
  function zentraleGoogle(zustand, jetzt) {
    if (!zustand) return null;
    jetzt = jetzt || Date.now();
    if (zustand.google === false) return { ok: false, text: 'Nein – in der Zentrale ist kein Google-Skript eingetragen.' };
    const bote = (zustand.agenten || []).find((a) => a && a.id === 'bote');
    if (!bote) return null;
    if (bote.status === 'fehler') {
      const m = String(bote.letzteAktion || '').replace(/\s+/g, ' ').trim();
      return { ok: false, text: 'Nein – letzter Versuch der Zentrale: ' + (m.length > 140 ? m.slice(0, 140) + '…' : m || 'Fehler') };
    }
    const zuletzt = Date.parse(bote.zuletzt || '');
    if (!zuletzt) return { ok: null, text: 'Noch keine Rückmeldung – die Zentrale prüft gleich.' };
    const sek = Math.max(0, Math.round((jetzt - zuletzt) / 1000));
    if (sek > 300) return { ok: null, text: `Unklar – letzte Rückmeldung vor ${Math.round(sek / 60)} Min.` };
    return { ok: true, text: `Ja – zuletzt vor ${sek < 60 ? sek + ' s' : Math.round(sek / 60) + ' Min.'} bestätigt.` };
  }

  /** „heute 14:32 Uhr“, „gestern 09:10 Uhr“ oder „3.11. 18:00 Uhr“. */
  function zeitText(ms, jetzt) {
    if (!ms) return 'noch nie (auf diesem Gerät)';
    const d = new Date(ms), j = new Date(jetzt || Date.now());
    const uhr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' Uhr';
    const tag = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((tag(j) - tag(d)) / 86400000);
    if (diff === 0) return 'heute ' + uhr;
    if (diff === 1) return 'gestern ' + uhr;
    return d.getDate() + '.' + (d.getMonth() + 1) + '. ' + uhr;
  }

  return { LAENGE_GOOGLE, LAENGE_KOPPLUNG, ABSTAENDE, URL_MUSTER, schluesselArt, maskiert, schluesselPruefen, felderGetauscht,
    einordnen, artText, ART_KURZ, skriptAufruf, sollWiederholen, mitWiederholung, zentraleGoogle, zeitText };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GoogleDiagnose;
if (typeof window !== 'undefined') window.GoogleDiagnose = GoogleDiagnose;
