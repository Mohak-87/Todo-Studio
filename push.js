/* Todo Studio – Benachrichtigungen aufs Handy per Web-Push (Erinnerungen von MO, auch bei geschlossener App) */
'use strict';

const Push = (() => {
  const esc = (s) => Studio.esc(s);
  const unterstuetzt = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
  const alsApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let abo = null;   // Abo dieses Geräts (falls vorhanden)
  let stand = null; // letzter Stand der Zentrale nach eigener Aktion (Zahl der Geräte)

  async function zentrale(methode, pfad, body) {
    const c = Studio.cfg;
    if (!c.zentrale || c.zentrale === 'demo') throw new Error('Benachrichtigungen brauchen die echte Zentrale (nicht den Demo-Modus).');
    const res = await fetch(c.zentrale + pfad, {
      method: methode,
      headers: { Authorization: 'Bearer ' + c.zentraleSchluessel, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    let r;
    try { r = await res.json(); } catch (e) { throw new Error('Zentrale antwortet unerwartet (HTTP ' + res.status + ').'); }
    if (!r.ok) throw new Error(r.fehler || 'Fehler der Zentrale');
    return r.daten;
  }

  function schluesselBytes(b64) {
    const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }

  async function aboLesen() {
    if (!unterstuetzt()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    abo = reg ? await reg.pushManager.getSubscription() : null;
    return abo;
  }

  /** Benachrichtigungen erlauben und dieses Gerät bei der Zentrale anmelden (nur per Klick – Browser verlangen das). */
  async function erlauben() {
    if (!unterstuetzt()) throw new Error(iphone() && !alsApp() ? 'Auf dem iPhone zuerst über „Teilen → Zum Home-Bildschirm“ installieren und das Studio dann von dort öffnen.' : 'Dieser Browser unterstützt keine Push-Benachrichtigungen.');
    if (!isSecureContext) throw new Error('Benachrichtigungen gehen nur über HTTPS.');
    const erlaubnis = await Notification.requestPermission();
    if (erlaubnis !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt. Das lässt sich in den Einstellungen des Browsers bzw. Handys ändern.');
    const { publicKey } = await zentrale('GET', '/api/push/stand');
    const reg = await navigator.serviceWorker.ready;
    let a = await reg.pushManager.getSubscription();
    // Abo zu einem anderen Schlüssel (z. B. neue Zentrale)? Dann neu abonnieren
    const alt = a && a.options && a.options.applicationServerKey;
    if (a && alt && btoa(String.fromCharCode(...new Uint8Array(alt))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) { await a.unsubscribe(); a = null; }
    if (!a) a = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(publicKey) });
    const geraet = (iphone() ? 'iPhone/iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computer') + ' · ' + new Date().toLocaleDateString('de-DE');
    stand = await zentrale('POST', '/api/push/abo', { abo: a.toJSON(), geraet });
    abo = a;
  }

  async function abmelden() {
    const a = await aboLesen();
    if (a) { stand = await zentrale('POST', '/api/push/abmelden', { endpoint: a.endpoint }).catch(() => stand); await a.unsubscribe(); }
    abo = null;
  }

  async function testen() {
    const r = await zentrale('POST', '/api/push/test', {});
    stand = r;
    if (!r.gesendet && !r.fehler.length) throw new Error('Noch kein Gerät angemeldet – zuerst „Benachrichtigungen erlauben“.');
    if (r.fehler.length) throw new Error(`Gesendet an ${r.gesendet} Gerät(e). Fehler: ${r.fehler.join('; ')}`);
    return r;
  }

  /** Karte im Reiter „Meldungen“. */
  function karteHtml(z) {
    const p = stand || (z && z.push) || { abos: 0 };
    const erlaubt = unterstuetzt() && Notification.permission === 'granted';
    const hinweis = !unterstuetzt()
      ? (iphone() && !alsApp() ? 'Auf dem iPhone: Studio in Safari über „Teilen → Zum Home-Bildschirm“ hinzufügen und von dort öffnen (ab iOS 16.4).' : 'Dieser Browser unterstützt kein Web-Push.')
      : Notification.permission === 'denied' ? 'Benachrichtigungen sind für das Studio blockiert – bitte in den Browser- bzw. Handy-Einstellungen erlauben.' : '';
    return `<div class="karte" id="pushKarte">
      <h3>Erinnerungen aufs Handy (Web-Push)</h3>
      <p class="leise">MOs Erinnerungen kommen als Benachrichtigung – auch wenn das Studio geschlossen ist. Je Gerät einmal erlauben. Angemeldete Geräte: <b>${p.abos}</b>${erlaubt && abo ? ' · dieses Gerät ist angemeldet' : ''}</p>
      ${hinweis ? `<p class="hilfe">${esc(hinweis)}</p>` : ''}
      <div class="knopf-reihe">
        ${unterstuetzt() ? `<button class="knopf ${erlaubt && abo ? '' : 'haupt-knopf'}" data-push="erlauben">${erlaubt && abo ? 'Erneut anmelden' : 'Benachrichtigungen erlauben'}</button>` : ''}
        <button class="knopf" data-push="test">Testbenachrichtigung</button>
        ${abo ? '<button class="knopf klein" data-push="abmelden">Dieses Gerät abmelden</button>' : ''}
      </div>
    </div>`;
  }

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-push]');
    if (!el) return;
    el.disabled = true;
    try {
      const was = el.dataset.push;
      if (was === 'erlauben') { await erlauben(); Studio.toast('Benachrichtigungen erlaubt – dieses Gerät ist angemeldet.'); }
      if (was === 'test') { await testen(); Studio.toast('Testbenachrichtigung gesendet.'); }
      if (was === 'abmelden') { await abmelden(); Studio.toast('Dieses Gerät bekommt keine Benachrichtigungen mehr.'); }
    } catch (err) {
      Studio.toast(err.message, 8000);
    } finally { el.disabled = false; Studio.zeichnen(); }
  });

  aboLesen().catch(() => {});
  return { karteHtml, erlauben, testen, abmelden };
})();

window.Push = Push;
