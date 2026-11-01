/* Todo Studio – Seitenanzeigen um die Wolke (wie ein Jarvis-HUD).
   Links: Lage, Heute, Eingang. Rechts: Team und System. Handy: eine kompakte Leiste unter dem Kopf.
   Liest nur, was Studio (Google) und Jarvis (Zentrale) ohnehin geladen haben. */
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => Studio.esc(s);
  const AN = 'studio.hud';
  const links = $('#hudLinks'), rechts = $('#hudRechts'), leiste = $('#hudLeiste');
  const knopf = $('#knopfHud');

  let sichtbar = true;
  try { sichtbar = localStorage.getItem(AN) !== 'aus'; } catch (e) { /* privater Modus */ }

  const minuten = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const jetztMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const dauer = (min) => (min >= 60 ? Math.floor(min / 60) + ' Std. ' + (min % 60 ? (min % 60) + ' Min.' : '') : min + ' Min.').trim();

  function heute() { return Studio.z.heute; }
  function zentrale() { return window.Jarvis ? Jarvis.zustand : null; }

  /** Nächster Termin heute (oder in der Vorschau), der noch nicht vorbei ist. */
  function naechsterTermin(d) {
    const jetzt = jetztMin();
    const t = (d.termine || []).filter((x) => !x.ganztags && minuten(x.ende) > jetzt).sort((a, b) => minuten(a.start) - minuten(b.start))[0];
    if (t) return { ...t, heute: true };
    const v = (d.vorschau || []).find((x) => x.datum > Studio.heuteIso() && !x.ganztags);
    return v ? { ...v, heute: false } : null;
  }

  function panel(titel, inhalt, ziel, extra = '') {
    return `<section class="hud-panel glas" ${ziel ? `data-ziel="${ziel}" role="button" tabindex="0"` : ''}>
      <header><span>${titel}</span>${extra}</header>${inhalt}</section>`;
  }
  const zeile = (links, rechts, klasse = '') => `<li class="${klasse}"><span>${links}</span>${rechts != null ? `<b>${rechts}</b>` : ''}</li>`;

  function lageHtml(d) {
    const jetzt = new Date();
    let h = `<div class="hud-uhr">${jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="hud-datum">${jetzt.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;
    if (d) {
      const n = naechsterTermin(d);
      if (n && n.heute) {
        const bis = minuten(n.start) - jetztMin();
        h += `<p class="hud-naechst"><small>${bis > 0 ? 'Nächster Termin in ' + dauer(bis) : 'Läuft gerade'}</small>${esc(n.titel)}<em>${n.start}–${n.ende}${n.ort ? ' · ' + esc(n.ort) : ''}</em></p>`;
      } else if (n) {
        h += `<p class="hud-naechst"><small>Heute kein Termin mehr · danach</small>${esc(n.titel)}<em>${Studio.datumKurz(n.datum)} · ${n.start}</em></p>`;
      } else h += '<p class="hud-naechst"><small>Keine Termine in Sicht</small></p>';
      const a = d.plan && d.plan.auslastung;
      if (a) h += `<div class="hud-balken ${a.prozent > 100 ? 'voll' : ''}"><i style="width:${Math.min(100, a.prozent)}%"></i></div><small class="hud-leise">Auslastung ${a.prozent} % · frei ${dauer(a.freiMin)}</small>`;
    }
    return panel('Lage', h, 'heute');
  }

  function heuteHtml(d) {
    if (!d) return panel('Heute', '<p class="hud-leise">Google nicht verbunden.</p>', 'heute');
    const jetzt = jetztMin();
    const termine = (d.termine || []).filter((t) => t.ganztags || minuten(t.ende) > jetzt).slice(0, 4);
    const offen = (d.aufgaben && d.aufgaben.offen) || [];
    const faellig = offen.filter((a) => a.faellig && a.faellig <= Studio.heuteIso());
    let h = '<ul class="hud-liste">';
    termine.forEach((t) => { h += zeile(`<i class="punkt termin"></i>${esc(t.titel)}`, t.ganztags ? 'ganzt.' : t.start); });
    if (!termine.length) h += zeile('<i class="punkt"></i>Keine Termine mehr', null, 'leise');
    h += '</ul><ul class="hud-liste">';
    faellig.slice(0, 4).forEach((a) => { h += zeile(`<i class="punkt ${a.faellig < Studio.heuteIso() ? 'warn' : 'aufgabe'}"></i>${esc(a.titel)}`, a.faellig < Studio.heuteIso() ? 'überfällig' : 'heute'); });
    if (!faellig.length) h += zeile('<i class="punkt ok"></i>Nichts fällig', null, 'leise');
    h += '</ul>';
    const erledigt = ((d.aufgaben && d.aufgaben.erledigtHeute) || []).length;
    return panel('Heute', h, 'aufgaben', `<b class="hud-zahl">${offen.length}<small> offen${erledigt ? ' · ' + erledigt + ' erledigt' : ''}</small></b>`);
  }

  function eingangHtml(d) {
    if (!d) return '';
    const mails = d.mails || [];
    const wichtig = mails.filter((m) => m.wichtig);
    let h = '<ul class="hud-liste">';
    (wichtig.length ? wichtig : mails).slice(0, 3).forEach((m) => { h += zeile(`<i class="punkt ${m.wichtig ? 'warn' : ''}"></i>${esc(m.betreff || '(ohne Betreff)')}`, esc(String(m.von || '').split(/[<@]/)[0].trim().slice(0, 14))); });
    if (!mails.length) h += zeile('<i class="punkt ok"></i>Posteingang leer', null, 'leise');
    h += '</ul>';
    return panel('Eingang', h, 'mails', `<b class="hud-zahl">${mails.length}<small> ungelesen${wichtig.length ? ' · ' + wichtig.length + ' wichtig' : ''}</small></b>`);
  }

  function teamHtml(z) {
    if (!z) return panel('Team', '<p class="hud-leise">Zentrale nicht verbunden.</p>', 'sitzungen');
    const laufend = (z.auftraege || []).filter((a) => ['geplant', 'laeuft', 'prueft'].includes(a.status));
    const aktiv = Object.values(z.aktiveAgenten || {}).filter((s) => s === 'arbeitet' || s === 'laeuft').length;
    const freigaben = (z.vorschlaege || []).filter((v) => v.status === 'offen').length;
    const sitzungen = (z.sitzungen || []).filter((s) => ['laeuft', 'wartet'].includes(s.status));
    let h = `<div class="hud-kennzahlen">
      <div><b>${aktiv}</b><small>Agenten aktiv</small></div>
      <div><b>${laufend.length}</b><small>Aufträge</small></div>
      <div class="${freigaben ? 'warn' : ''}"><b>${freigaben}</b><small>Freigaben</small></div></div><ul class="hud-liste">`;
    laufend.slice(0, 3).forEach((a) => {
      const fertig = a.schritte.filter((s) => s.status === 'fertig').length;
      h += zeile(`<i class="punkt aktiv"></i>${esc(a.titel)}`, `${fertig}/${a.schritte.length}`);
    });
    sitzungen.slice(0, 2).forEach((s) => { h += zeile(`<i class="punkt aktiv"></i>${esc(s.titel)}`, s.status === 'wartet' ? 'wartet' : 'läuft'); });
    if (!laufend.length && !sitzungen.length) h += zeile('<i class="punkt"></i>Kein Auftrag in Arbeit', null, 'leise');
    return panel('Team', h + '</ul>', 'sitzungen');
  }

  /** Nächste geplante Routine (Ablauf nach Zeitplan), z. B. „Mo 08:00 Morgen-Lagebericht“. */
  function routineHtml(z) {
    const r = ((z && z.routinen) || []).filter((x) => x.aktiv && x.naechster).sort((a, b) => a.naechster.localeCompare(b.naechster))[0];
    if (!r) return '';
    const n = new Date(r.naechster), istHeute = Studio.heuteIso(n) === Studio.heuteIso();
    const wann = (istHeute ? 'heute' : n.toLocaleDateString('de-DE', { weekday: 'short' })) + ' ' + r.zeit;
    return `<ul class="hud-liste">${zeile(`<i class="punkt aktiv"></i>${esc(r.name)}`, wann)}</ul>`;
  }

  function systemHtml(z) {
    const g = !!heute(), verbunden = !!z;
    const st = z && z.stimme, ge = z && z.gedaechtnis;
    const mo = z && z.jarvis ? ({ denkt: 'denkt nach', bereit: 'bereit', fehler: 'Störung' }[z.jarvis.status] || z.jarvis.status) : 'getrennt';
    const h = `<ul class="hud-liste">
      ${zeile(`<i class="punkt ${verbunden ? 'ok' : 'fehler'}"></i>Zentrale`, verbunden ? 'verbunden' : 'getrennt')}
      ${zeile(`<i class="punkt ${g ? 'ok' : 'fehler'}"></i>Google`, g ? 'verbunden' : 'getrennt')}
      ${zeile(`<i class="punkt mo"></i>MO`, esc(mo))}
      ${zeile(`<i class="punkt ${st && st.bereit ? 'ok' : ''}"></i>Stimme`, st && st.bereit ? esc(st.name.replace(/\s*\(.*\)/, '')) : 'Browser')}
      ${ge ? zeile('<i class="punkt mo"></i>Gedächtnis', `${ge.erinnerungen} Erinn. · ${ge.tage} Tage`) : ''}
    </ul>${routineHtml(z)}`;
    return panel('System', h, '');
  }

  function leisteHtml(d, z) {
    const chips = [];
    if (d) {
      const n = naechsterTermin(d);
      chips.push(['termine', '◷', n && n.heute ? n.start + ' ' + esc(n.titel) : 'frei']);
      const offen = (d.aufgaben && d.aufgaben.offen) || [];
      chips.push(['aufgaben', '✓', offen.filter((a) => a.faellig && a.faellig <= Studio.heuteIso()).length + ' fällig']);
      chips.push(['mails', '✉', (d.mails || []).length]);
    }
    if (z) {
      const laufend = (z.auftraege || []).filter((a) => ['geplant', 'laeuft', 'prueft'].includes(a.status)).length;
      const freigaben = (z.vorschlaege || []).filter((v) => v.status === 'offen').length;
      chips.push(['sitzungen', '⌘', laufend + (freigaben ? ' · ' + freigaben + ' frei?' : '')]);
    }
    return chips.map(([ziel, icon, text]) => `<button type="button" data-ziel="${ziel}"><span>${icon}</span>${text}</button>`).join('');
  }

  function zeichnen() {
    document.body.classList.toggle('hud-aus', !sichtbar);
    knopf.setAttribute('aria-pressed', String(sichtbar));
    if (!sichtbar) return;
    const d = heute(), z = zentrale();
    links.innerHTML = lageHtml(d) + heuteHtml(d) + eingangHtml(d);
    rechts.innerHTML = teamHtml(z) + systemHtml(z);
    leiste.innerHTML = leisteHtml(d, z);
  }

  function klick(ev) {
    const el = ev.target.closest('[data-ziel]');
    if (el && el.dataset.ziel) Studio.oeffne(el.dataset.ziel);
  }
  [links, rechts, leiste].forEach((e) => {
    e.addEventListener('click', klick);
    e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); klick(ev); } });
  });
  knopf.addEventListener('click', () => {
    sichtbar = !sichtbar;
    try { localStorage.setItem(AN, sichtbar ? 'an' : 'aus'); } catch (e) { /* egal */ }
    zeichnen();
    window.dispatchEvent(new Event('studio-layout')); // Wolke neu mittig setzen
  });

  document.addEventListener('studio:daten', zeichnen);
  setInterval(zeichnen, 30000); // Uhr und Countdown
  zeichnen();
  window.Hud = { zeichnen };
})();
