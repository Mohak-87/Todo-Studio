/* Todo Studio – Chat-Darstellung: sicheres Markdown, Syntaxhervorhebung, Karten für technische Meldungen, Bild-Vorschauen.
 * Sicherheit: Der Text wird IMMER zuerst maskiert. Eingebettetes HTML erscheint als Text, nie als Element.
 * Links und Bilder nur mit http(s) (Links zusätzlich mailto/tel) – javascript:, data: usw. werden zu reinem Text.
 * Läuft im Browser (window.ChatFormat) und in Node (module.exports) – siehe tests/chatformat.test.js. */
'use strict';

const ChatFormat = (() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]); }

  // ---------- Adressen ----------
  const BILD_ENDUNG = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#][^\s]*)?$/i;
  /** Liefert eine sichere Adresse oder '' (nur http/https, für Links zusätzlich mailto/tel). */
  function sichereUrl(roh, { bild = false } = {}) {
    const u = String(roh || '').trim().replace(/^<|>$/g, '');
    if (!u || /[\u0000-\u001f\u007f\s]/.test(u)) return '';
    if (/^https?:\/\/[^/\s]+/i.test(u)) return u;
    if (!bild && /^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return u;
    if (!bild && /^tel:\+?[\d\s()/-]{3,}$/i.test(u)) return u;
    return '';
  }
  function istBildUrl(u) { return BILD_ENDUNG.test(String(u || '').split('#')[0]); }

  // ---------- Syntaxhervorhebung (eigene, kleine Tokenizer – ohne externe Bibliothek) ----------
  const WORT = (l) => '\\b(?:' + l.split(' ').join('|') + ')\\b';
  const STR_DQ = '"(?:[^"\\\\\\n]|\\\\.)*"', STR_SQ = "'(?:[^'\\\\\\n]|\\\\.)*'", STR_BT = '`(?:[^`\\\\]|\\\\.)*`';
  const ZAHL = '\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b';
  const SPRACHEN = {
    js: [
      ['c', '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'], ['s', STR_BT + '|' + STR_DQ + '|' + STR_SQ],
      ['k', WORT('const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this super yield delete void static get set')],
      ['l', WORT('true false null undefined NaN Infinity')], ['n', ZAHL], ['f', '\\b[A-Za-z_$][\\w$]*(?=\\s*\\()']
    ],
    py: [
      ['c', '#[^\\n]*'], ['s', '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|[rbfu]?' + STR_DQ + '|[rbfu]?' + STR_SQ],
      ['k', WORT('def return if elif else for while in not and or is import from as class try except finally raise with lambda yield pass break continue global nonlocal async await assert del')],
      ['l', WORT('True False None self')], ['n', ZAHL], ['f', '\\b[A-Za-z_]\\w*(?=\\s*\\()']
    ],
    sh: [
      ['c', '(?:^|\\s)#[^\\n]*'], ['s', STR_DQ + '|' + STR_SQ],
      ['k', WORT('if then else elif fi for in do done while case esac function return export local sudo cd echo exit set source')],
      ['v', '\\$\\{?[\\w@#?*!-]+\\}?'], ['l', '(?:^|\\s)--?[\\w-]+'], ['n', ZAHL]
    ],
    json: [['p', STR_DQ + '(?=\\s*:)'], ['s', STR_DQ], ['l', WORT('true false null')], ['n', '-?' + ZAHL]],
    css: [
      ['c', '\\/\\*[\\s\\S]*?\\*\\/'], ['s', STR_DQ + '|' + STR_SQ], ['p', '[\\w-]+(?=\\s*:[^;{}]*[;}])'],
      ['k', '@[\\w-]+|!important'], ['n', '#[\\da-fA-F]{3,8}\\b|-?\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\\b']
    ],
    html: [
      ['c', '<!--[\\s\\S]*?-->'], ['t', '<\\/?[A-Za-z][\\w:-]*|\\/?>'], ['a', '\\b[\\w:-]+(?==)'], ['s', STR_DQ + '|' + STR_SQ]
    ],
    sql: [
      ['c', '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'], ['s', STR_SQ],
      ['k', '(?i:' + WORT('select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as distinct union primary key references index null is in like between case when then else end') + ')'],
      ['n', ZAHL]
    ]
  };
  const ALIAS = { javascript: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', jsx: 'js', tsx: 'js', node: 'js', gs: 'js',
    python: 'py', py3: 'py', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', cmd: 'sh', powershell: 'sh', ps1: 'sh',
    xml: 'html', svg: 'html', htm: 'html', vue: 'html', scss: 'css', less: 'css', jsonc: 'json', json5: 'json' };
  const REGEX_CACHE = {};
  function spracheVon(name, code) {
    const n = String(name || '').toLowerCase().trim();
    if (SPRACHEN[n]) return n;
    if (ALIAS[n]) return ALIAS[n];
    if (n) return '';
    const t = String(code || '').trim();
    if (/^[[{]/.test(t) && /[\]}]$/.test(t)) return 'json';
    if (/^(\$ |npm |npx |node |git |cd |ls |sudo |curl |pip |python3? )/m.test(t)) return 'sh';
    if (/^<(!DOCTYPE|html|div|svg|\?xml)/i.test(t)) return 'html';
    if (/\b(const|let|function|=>|import .* from)\b/.test(t)) return 'js';
    if (/^\s*(def |import |from \S+ import )/m.test(t)) return 'py';
    return '';
  }
  function regexFuer(sprache) {
    if (REGEX_CACHE[sprache]) return REGEX_CACHE[sprache];
    const teile = SPRACHEN[sprache];
    // (?i:…) kennt nicht jede Engine – SQL-Schlüsselwörter darum über das i-Flag der Gruppe nachbilden
    const quelle = teile.map(([, q]) => '(' + q.replace(/^\(\?i:([\s\S]*)\)$/, '$1') + ')').join('|');
    const re = { re: new RegExp(quelle, sprache === 'sql' ? 'gmi' : 'gm'), klassen: teile.map(([k]) => k) };
    REGEX_CACHE[sprache] = re;
    return re;
  }
  /** Gibt maskiertes HTML mit <span class="hl-…">-Markierungen zurück. */
  function hervorheben(code, sprache) {
    const s = spracheVon(sprache, code);
    const text = String(code || '');
    if (!s) return esc(text);
    let r;
    try { r = regexFuer(s); } catch (e) { return esc(text); } // ältere Browser: lieber ohne Farben als gar nicht
    const { re, klassen } = r;
    re.lastIndex = 0;
    let aus = '', pos = 0, m;
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; }
      const gruppe = m.slice(1).findIndex((x) => x !== undefined);
      aus += esc(text.slice(pos, m.index)) + `<span class="hl-${klassen[gruppe]}">${esc(m[0])}</span>`;
      pos = m.index + m[0].length;
    }
    return aus + esc(text.slice(pos));
  }

  // ---------- Inline ----------
  const P = '\u0000'; // Platzhalter-Zeichen (kommt in normalem Text nicht vor)
  function bildHtml(url, alt, quelle) {
    return `<span class="md-bild"><img class="md-bild-img" src="${esc(url)}" alt="${esc(alt || 'Bild')}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-gross="${esc(url)}" data-link="${esc(quelle || url)}"></span>`;
  }
  function linkHtml(url, inhaltHtml) {
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${inhaltHtml}</a>`;
  }

  function inline(roh, { ohneLinks = false } = {}) {
    let t = String(roh == null ? '' : roh).replace(new RegExp(P, 'g'), '');
    const ablage = [];
    const merke = (html) => { ablage.push(html); return P + (ablage.length - 1) + P; };
    // 1. Code-Spans (Inhalt bleibt wörtlich)
    t = t.replace(/(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1(?!`)/g, (_, z, c) => merke(`<code>${esc(c.replace(/^ (.*) $/, '$1'))}</code>`));
    // 2. Bilder ![alt](url)
    t = t.replace(/!\[([^\]\n]*)\]\(\s*<?([^\s)<>]+)>?(?:\s+"[^"\n]*")?\s*\)/g, (ganz, alt, url) => {
      const u = sichereUrl(url, { bild: true });
      return u ? merke(bildHtml(u, alt)) : merke(esc(alt || ''));
    });
    if (!ohneLinks) {
      // 3. Links [text](url)
      t = t.replace(/\[([^\]\n]+)\]\(\s*<?([^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)>?(?:\s+"[^"\n]*")?\s*\)/g, (ganz, text, url) => {
        const u = sichereUrl(url);
        const innen = inline(text, { ohneLinks: true });
        if (!u) return merke(innen);
        return merke(linkHtml(u, innen) + (istBildUrl(u) && /^https?:/i.test(u) ? bildHtml(u, text) : ''));
      });
      // 4. Nackte Adressen (Bild-Adressen zusätzlich als Vorschau)
      t = t.replace(/(^|[\s(„"'>])((?:https?:\/\/|www\.)[^\s<>"'`„“]+)/gi, (ganz, vor, url) => {
        let u = url, rest = '';
        while (/[.,;:!?)\]“”'"*_]$/.test(u)) {
          if (u.endsWith(')') && (u.match(/\(/g) || []).length >= (u.match(/\)/g) || []).length) break;
          rest = u.slice(-1) + rest; u = u.slice(0, -1);
        }
        const ziel = sichereUrl(/^www\./i.test(u) ? 'https://' + u : u);
        if (!ziel) return ganz;
        return vor + merke(linkHtml(ziel, esc(u)) + (istBildUrl(ziel) ? bildHtml(ziel, '') : '')) + rest;
      });
    }
    // 5. Maskieren, danach Hervorhebungen
    t = esc(t);
    t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    t = t.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
    t = t.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
    // 6. Platzhalter zurück (verschachtelt möglich)
    const zurueck = (s) => s.replace(new RegExp(P + '(\\d+)' + P, 'g'), (_, i) => zurueck(ablage[+i]));
    return zurueck(t);
  }

  // ---------- Blöcke ----------
  const RE_FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([\w+#.-]*)[^\n`]*$/;
  const RE_UEBER = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
  const RE_LINIE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const RE_LISTE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
  const RE_ZITAT = /^\s{0,3}>\s?(.*)$/;
  const RE_TRENNER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function zellen(zeile) {
    let z = zeile.trim();
    if (z.startsWith('|')) z = z.slice(1);
    if (z.endsWith('|') && !z.endsWith('\\|')) z = z.slice(0, -1);
    const aus = []; let akt = '', imCode = false;
    for (let i = 0; i < z.length; i++) {
      const c = z[i];
      if (c === '\\' && z[i + 1] === '|') { akt += '|'; i++; continue; }
      if (c === '`') imCode = !imCode;
      if (c === '|' && !imCode) { aus.push(akt.trim()); akt = ''; continue; }
      akt += c;
    }
    aus.push(akt.trim());
    return aus;
  }

  function tabelleHtml(kopf, trenner, zeilen) {
    const ausr = zellen(trenner).map((s) => /^:-+:$/.test(s) ? 'center' : /-:$/.test(s) ? 'right' : '');
    const k = zellen(kopf);
    const stil = (i) => ausr[i] ? ` style="text-align:${ausr[i]}"` : '';
    let h = '<div class="md-tabelle"><table><thead><tr>' + k.map((c, i) => `<th${stil(i)}>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
    for (const z of zeilen) {
      const c = zellen(z);
      h += '<tr>' + k.map((_, i) => `<td${stil(i)}>${inline(c[i] || '')}</td>`).join('') + '</tr>';
    }
    return h + '</tbody></table></div>';
  }

  function codeHtml(code, sprache) {
    const s = spracheVon(sprache, code);
    const name = String(sprache || '').trim() || (s ? { js: 'JavaScript', py: 'Python', sh: 'Shell', json: 'JSON', css: 'CSS', html: 'HTML', sql: 'SQL' }[s] : 'Code');
    return `<div class="md-code"><div class="md-code-kopf"><span>${esc(name)}</span><button type="button" class="md-kopieren" data-j="code-kopieren" aria-label="Code kopieren">Kopieren</button></div><pre><code${s ? ` class="sprache-${s}"` : ''}>${hervorheben(code, sprache)}</code></pre></div>`;
  }

  function einruecken(z) { const m = /^\s*/.exec(z)[0]; return m.replace(/\t/g, '    ').length; }

  /** Liste ab Zeile i einlesen; liefert [html, nächste Zeile]. */
  function liste(zeilen, i, tiefe) {
    const erste = RE_LISTE.exec(zeilen[i]);
    const basis = einruecken(zeilen[i]);
    const geordnet = /\d/.test(erste[2]);
    const start = geordnet ? parseInt(erste[2], 10) : 1;
    const punkte = [];
    let locker = false;
    while (i < zeilen.length) {
      const m = RE_LISTE.exec(zeilen[i]);
      if (!m || einruecken(zeilen[i]) !== basis || /\d/.test(m[2]) !== geordnet) break;
      const inhalt = [m[3]];
      const innenEinzug = basis + m[2].length + 1;
      i++;
      let leerDavor = false;
      while (i < zeilen.length) {
        const z = zeilen[i];
        if (!z.trim()) { leerDavor = true; i++; continue; }
        const ez = einruecken(z);
        const mz = RE_LISTE.exec(z);
        if (mz && ez <= basis) { if (leerDavor && ez === basis && /\d/.test(mz[2]) === geordnet) locker = true; break; }
        if (ez > basis) { if (leerDavor) inhalt.push(''); inhalt.push(z.slice(Math.min(ez, innenEinzug))); leerDavor = false; i++; continue; }
        if (leerDavor) break; // Absatz nach der Liste
        if (RE_FENCE.test(z) || RE_UEBER.test(z) || RE_ZITAT.test(z) || RE_LINIE.test(z)) break;
        inhalt.push(z.trim()); i++; // Fortsetzungszeile ohne Einzug
      }
      punkte.push(inhalt);
      if (leerDavor && !(i < zeilen.length && RE_LISTE.test(zeilen[i]) && einruecken(zeilen[i]) === basis)) break;
    }
    const tag = geordnet ? 'ol' : 'ul';
    const attr = geordnet && start !== 1 ? ` start="${start}"` : '';
    const html = `<${tag}${attr}>` + punkte.map((inhalt) => {
      let text = inhalt.join('\n');
      let haken = '';
      const t = /^\[([ xX])\]\s+/.exec(text);
      if (t) { haken = t[1] === ' ' ? '<span class="md-haken">☐</span> ' : '<span class="md-haken an">☑</span> '; text = text.slice(t[0].length); }
      const innen = bloecke(text, tiefe + 1);
      // Enge Liste: einzelner Absatz ohne <p>
      const eng = !locker && /^<p>[\s\S]*?<\/p>/.test(innen) && innen.indexOf('<p>', 1) < 0;
      return `<li>${haken}${eng ? innen.replace(/^<p>([\s\S]*?)<\/p>/, '$1') : innen}</li>`;
    }).join('') + `</${tag}>`;
    return [html, i];
  }

  function bloecke(text, tiefe = 0) {
    if (tiefe > 8) return `<p>${inline(text)}</p>`;
    const zeilen = String(text).replace(/\r\n?/g, '\n').split('\n');
    let h = '', i = 0, absatz = [];
    const absatzEnde = () => { if (absatz.length) { h += '<p>' + absatz.map((z) => inline(z.trim())).join('<br>') + '</p>'; absatz = []; } };
    while (i < zeilen.length) {
      const z = zeilen[i];
      if (!z.trim()) { absatzEnde(); i++; continue; }
      let m;
      if ((m = RE_FENCE.exec(z))) {
        absatzEnde();
        const zaun = m[2], einzug = m[1].length, code = [];
        i++;
        while (i < zeilen.length && !new RegExp('^\\s{0,3}' + zaun[0] + '{' + zaun.length + ',}\\s*$').test(zeilen[i])) {
          code.push(zeilen[i].slice(Math.min(einzug, einruecken(zeilen[i])))); i++;
        }
        i++; // schließender Zaun (oder Textende – dann gilt der Rest als Code)
        h += codeHtml(code.join('\n'), m[3]);
        continue;
      }
      if ((m = RE_UEBER.exec(z))) {
        absatzEnde();
        const stufe = Math.min(6, m[1].length + 2); // # → h3: Überschriften im Chat bleiben dezent
        h += `<h${stufe} class="md-ueber">${inline(m[2])}</h${stufe}>`;
        i++; continue;
      }
      if (RE_LINIE.test(z) && !(absatz.length && /^\s*-+\s*$/.test(z))) { absatzEnde(); h += '<hr>'; i++; continue; }
      if (RE_ZITAT.test(z)) {
        absatzEnde();
        const innen = [];
        while (i < zeilen.length && zeilen[i].trim() && (m = RE_ZITAT.exec(zeilen[i]))) { innen.push(m[1]); i++; }
        h += `<blockquote>${bloecke(innen.join('\n'), tiefe + 1)}</blockquote>`;
        continue;
      }
      if (z.includes('|') && i + 1 < zeilen.length && RE_TRENNER.test(zeilen[i + 1]) && zeilen[i + 1].includes('-')) {
        absatzEnde();
        const kopf = z, trenner = zeilen[i + 1], reihen = [];
        i += 2;
        while (i < zeilen.length && zeilen[i].trim() && zeilen[i].includes('|')) { reihen.push(zeilen[i]); i++; }
        h += tabelleHtml(kopf, trenner, reihen);
        continue;
      }
      if (RE_LISTE.test(z) && (!absatz.length || !/^\s*\d/.test(z) || /^\s*1[.)]/.test(z))) {
        absatzEnde();
        const [html, weiter] = liste(zeilen, i, tiefe);
        h += html; i = weiter; continue;
      }
      absatz.push(z); i++;
    }
    absatzEnde();
    return h;
  }

  /** Markdown → sicheres HTML. Ältere Nachrichten in reinem Text bleiben lesbar (Zeilenumbrüche bleiben erhalten). */
  function markdownZuHtml(text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) return '';
    return bloecke(t, 0);
  }

  // ---------- Sprechtext (für die Sprachausgabe, falls „sprechen“ fehlt) ----------
  function zuSprechtext(text) {
    const zeilen = String(text == null ? '' : text).replace(/\r\n?/g, '\n')
      .replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(\n\s*\2\s*(?=\n|$)|$)/g, '\n')   // Codeblöcke werden nicht vorgelesen
      .split('\n');
    const aus = [];
    for (let z of zeilen) {
      if (RE_TRENNER.test(z) && z.includes('-')) continue;
      if (RE_LINIE.test(z)) continue;
      if (/^\s*\|.*\|\s*$/.test(z)) z = zellen(z).filter(Boolean).join(', ');
      z = z.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s{0,3}>\s?/, '').replace(/^\s*([-*+•]|\d{1,3}[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s+/, '')
        .replace(/!?\[([^\]]*)\]\([^()\s]*(?:\([^()\s]*\)[^()\s]*)*(?:\s+"[^"]*")?\)/g, '$1')
        .replace(/(https?:\/\/|www\.)\S+/g, '')
        .replace(/(\*\*|__|~~|`)/g, '').replace(/(^|[^\w*])\*(\S[^*]*?)\*(?!\w)/g, '$1$2').replace(/(^|[^\w])_(\S[^_]*?)_(?!\w)/g, '$1$2')
        .replace(/\s+/g, ' ').trim();
      if (!z) continue;
      aus.push(/[.!?:;,…]$/.test(z) ? z : z + '.');
    }
    return aus.join(' ').replace(/\s+([.,;:!?])/g, '$1').replace(/([.!?])\.+/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  // ---------- Karten für technische Meldungen und lange Ergebnisse ----------
  const KARTEN_ART = {
    sitzung: { symbol: '⌘', name: 'Claude-Sitzung' }, bau: { symbol: '⚒', name: 'Bau-Sitzung' }, test: { symbol: '✓', name: 'Test' },
    prompt: { symbol: '✎', name: 'Prompt.Studio' }, veroeffentlichen: { symbol: '⇪', name: 'Veröffentlichen' },
    system: { symbol: 'ⓘ', name: 'System' }, upload: { symbol: '📎', name: 'Datei' }, bericht: { symbol: '▤', name: 'Bericht' },
    neustart: { symbol: '↻', name: 'Neustart' }
  };
  const LANG_ZEICHEN = 1400;      // ab hier wird eine MO-Antwort mit Tabelle/Code zur Karte
  const SEHR_LANG_ZEICHEN = 2600; // ab hier jede MO-Antwort

  function statusAus(text) {
    const t = String(text || '');
    if (/Ampel:\s*Grün/i.test(t)) return { text: 'Ampel grün', ton: 'ok' };
    if (/Ampel:\s*Gelb/i.test(t)) return { text: 'Ampel gelb', ton: 'warn' };
    if (/Ampel:\s*Rot/i.test(t)) return { text: 'Ampel rot', ton: 'fehler' };
    if (/Rückfragen?|Wie weiter|Wie soll es weitergehen|wartet auf Ihre (Freigabe|Entscheidung)|Soll ich|\?\s*$/i.test(t.slice(0, 600)) && !(/bestanden\.?\s*$/i.test(t.split('\n')[0]) && !/nicht bestanden/i.test(t.split('\n')[0]))) {
      if (/fehlgeschlagen|nicht bestanden|gescheitert|Fehler/i.test(t.split('\n')[0])) return { text: 'Fehler – Entscheidung nötig', ton: 'fehler', frage: true };
      return { text: 'wartet auf Sie', ton: 'warn', frage: true };
    }
    if (/fehlgeschlagen|nicht bestanden|gescheitert|abgebrochen|zurückgerollt|nicht geklappt|Fehler/i.test(t.split('\n')[0])) return { text: 'Fehler', ton: 'fehler' };
    if (/bestanden|abgeschlossen|^Fertig|erfolgreich|veröffentlicht|ist ausgewertet|neu gestartet/i.test(t.split('\n')[0])) return { text: 'fertig', ton: 'ok' };
    if (/Zwischenstand|läuft|ich teste|setze .* fort/i.test(t.split('\n')[0])) return { text: 'läuft', ton: 'aktiv' };
    return { text: 'Info', ton: '' };
  }

  function kurzfassung(text, titel) {
    const ohne = String(text || '').replace(/```[\s\S]*?(```|$)/g, ' ').split('\n')
      .map((z) => z.trim()).filter((z) => z && !/^\|/.test(z) && !RE_TRENNER.test(z) && !/^#{1,6}\s/.test(z));
    let s = zuSprechtext(ohne.slice(0, 3).join('\n'));
    if (titel) s = s.replace(new RegExp('^' + titel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[:.\\s]*'), '');
    return s.length > 170 ? s.slice(0, 167).replace(/\s+\S*$/, '') + ' …' : s;
  }

  /** Erkennt technische Meldungen – auch bei älteren Nachrichten ohne Kennzeichnung. Liefert null oder { art, titel, status, kurz, offen }. */
  function karteFuer(m) {
    if (!m || m.von !== 'jarvis') return null;
    const text = String(m.text || '');
    const vorgabe = m.karte && typeof m.karte === 'object' ? m.karte : null;
    let art = vorgabe && KARTEN_ART[vorgabe.art] ? vorgabe.art : '', titel = vorgabe && vorgabe.titel ? String(vorgabe.titel) : '';
    let x;
    if (!art) {
      if ((x = /^Sitzung „([^“]+)“ ist abgeschlossen/.exec(text))) { art = 'sitzung'; titel = x[1]; }
      else if ((x = /^Die Sitzung „([^“]+)“ ist fehlgeschlagen/.exec(text))) { art = 'sitzung'; titel = x[1]; }
      else if ((x = /^„([^“]+)“ rührt sich seit/.exec(text))) { art = 'sitzung'; titel = x[1]; }
      else if ((x = /^(?:Testergebnis|Test von) „([^“]+)“/.exec(text))) { art = 'test'; titel = x[1]; }
      else if ((x = /^(?:Fertig|Zwischenstand): „([^“]+)“/.exec(text))) { art = 'bau'; titel = x[1]; }
      else if ((x = /^„([^“]+)“ (ist (zum dritten Mal hintereinander )?abgebrochen|lässt sich nicht weiterführen)/.exec(text))) { art = 'bau'; titel = x[1]; }
      else if (/^(Ampel: |Prompt\.Studio (hat|ist))/.test(text)) { art = 'prompt'; titel = 'Prompt.Studio'; }
      else if (/^Veröffentlichen /.test(text)) { art = 'veroeffentlichen'; titel = 'Umbau veröffentlichen'; }
      else if (/^(Neustart abgebrochen|Neustart fehlgeschlagen|Der Laptop wurde neu gestartet)/.test(text)) { art = 'neustart'; titel = 'Zentrale'; }
      else if (m.lokal && /^(Die Zentrale|Verbindung zur Zentrale|Guten Tag\. Die Zentrale)/.test(text)) { art = 'system'; titel = 'Verbindung zur Zentrale'; }
      else if (text.length > SEHR_LANG_ZEICHEN || (text.length > LANG_ZEICHEN && (/```/.test(text) || /^\s*\|.*\|\s*$/m.test(text)))) {
        art = 'bericht';
        const u = /^\s{0,3}#{1,6}\s+(.+)$/m.exec(text);
        titel = u ? zuSprechtext(u[1]) : 'Ausführliche Antwort';
      }
    }
    if (!art) return null;
    const st = vorgabe && vorgabe.status ? { text: String(vorgabe.status), ton: vorgabe.ton || statusAus(text).ton, frage: statusAus(text).frage } : statusAus(text);
    if (art === 'bericht' && st.text === 'Info') st.text = Math.round(text.length / 100) / 10 + ' Tsd. Zeichen';
    return { art, symbol: KARTEN_ART[art].symbol, name: KARTEN_ART[art].name, titel: titel || KARTEN_ART[art].name, status: st.text, ton: st.ton, kurz: kurzfassung(text, titel), offen: !!st.frage };
  }

  return { esc, sichereUrl, istBildUrl, hervorheben, spracheVon, inline, markdownZuHtml, zuSprechtext, karteFuer, statusAus, kurzfassung, KARTEN_ART };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatFormat;
