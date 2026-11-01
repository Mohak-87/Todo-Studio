/* Todo Studio – holografische Erdkugel in der Wolke.
   Erscheint, wenn MO über Orte spricht (Nachrichten, Länder, Städte): Die Wolke weicht, die Kugel dreht sich
   zu jedem Ort, sobald MO ihn erwähnt. Wird von wolke.js angelegt und in deren Bildschleife bewegt. */

const R = 5;                  // Radius der Kugel
const ABSTAND_UEBERSICHT = 17;
const ABSTAND_ORT = 12.5;
const NACHLAUF_MS = 9000;     // so lange bleibt die Kugel nach MOs letztem Satz stehen
const TAKT_OHNE_STIMME = 5500;

export function globusAnlegen({ THREE, scene, camera, controls, LEUCHT, schwach, reduziert, wolkeAusblenden }) {
  const gruppe = new THREE.Group();
  gruppe.visible = false;
  scene.add(gruppe);
  const D = Math.PI / 180;

  /** Breite/Länge → Punkt auf der Kugel (gleiche Abbildung wie eine Weltkarte im Plattkarten-Format). */
  function aufKugel(lat, lon, r = R, ziel = new THREE.Vector3()) {
    const phi = (90 - lat) * D, theta = (lon + 180) * D;
    return ziel.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }

  // ---------- Kugel ----------
  // dunkler Kern verdeckt die Rückseite, damit die Kugel als Körper wirkt
  gruppe.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 64, 48), new THREE.MeshBasicMaterial({ color: '#050913', transparent: true, opacity: 0.92 })));
  // Längen- und Breitengrade
  const netz = [];
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 4) netz.push(aufKugel(lat, lon, R * 1.002), aufKugel(lat, lon + 4, R * 1.002));
  for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) netz.push(aufKugel(lat, lon, R * 1.002), aufKugel(lat + 4, lon, R * 1.002));
  gruppe.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(netz),
    new THREE.LineBasicMaterial({ color: '#4f8fd6', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending })));
  // Atmosphäre
  const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color('#4b8dff'), transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
  atmo.scale.setScalar(R * 3.1);
  gruppe.add(atmo);

  // Kontinente als Lichtpunkte (Landmaske: schwarz = Land)
  const bild = new Image();
  bild.onload = () => {
    const c = document.createElement('canvas'); c.width = bild.width; c.height = bild.height;
    const g = c.getContext('2d'); g.drawImage(bild, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const istLand = (lat, lon) => {
      const x = Math.min(c.width - 1, Math.floor((lon + 180) / 360 * c.width));
      const y = Math.min(c.height - 1, Math.floor((90 - lat) / 180 * c.height));
      return px[(y * c.width + x) * 4] < 128;
    };
    const n = schwach ? 14000 : 26000, pos = [], farbe = [], f = new THREE.Color();
    const gold = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), w = gold * i;
      const lat = Math.asin(y) / D;
      const lon = (((Math.atan2(r * Math.sin(w), -r * Math.cos(w)) / D) - 180) + 540) % 360 - 180;
      if (!istLand(lat, lon)) continue;
      const p = aufKugel(lat, lon, R * 1.004);
      pos.push(p.x, p.y, p.z);
      f.setHSL(0.57 + Math.random() * 0.05, 0.75, 0.62 + Math.random() * 0.2);
      farbe.push(f.r, f.g, f.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(farbe, 3));
    gruppe.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: schwach ? 0.085 : 0.07, map: LEUCHT, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })));
  };
  bild.src = 'erde-maske.png';

  // ---------- Orte ----------
  const ortGruppe = new THREE.Group();
  gruppe.add(ortGruppe);
  let orte = [];          // { name, text, lat, lon, pos, punkt, strahl, ring, label }
  let aktuell = -1;

  const karte = document.createElement('div');
  karte.className = 'globus-karte glas';
  karte.hidden = true;
  karte.innerHTML = `<p class="globus-ober">Weltlage</p><h3 class="globus-name"></h3><p class="globus-text"></p>
    <div class="globus-knoepfe"><button type="button" data-g="zurueck" aria-label="Vorheriger Ort">‹</button><span class="globus-zahl"></span>
    <button type="button" data-g="weiter" aria-label="Nächster Ort">›</button><button type="button" data-g="zu" class="globus-zu">Zurück zur Wolke</button></div>`;
  document.body.appendChild(karte);
  karte.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-g]');
    if (!b) return;
    festgehalten = true;
    if (b.dataset.g === 'zu') verlassen();
    else if (orte.length) zuOrt((aktuell + (b.dataset.g === 'weiter' ? 1 : orte.length - 1)) % orte.length);
  });

  function orteLeeren() {
    for (const o of orte) o.label.remove();
    while (ortGruppe.children.length) {
      const k = ortGruppe.children.pop();
      k.geometry && k.geometry.dispose(); k.material && k.material.dispose();
    }
    orte = []; aktuell = -1;
  }

  function bogen(a, b) { // leuchtender Bogen zwischen zwei Orten, über der Oberfläche
    const pa = a.clone().normalize(), pb = b.clone().normalize(), punkte = [];
    const winkel = pa.angleTo(pb);
    for (let i = 0; i <= 48; i++) {
      const u = i / 48;
      const v = new THREE.Vector3().copy(pa).multiplyScalar(Math.sin((1 - u) * winkel)).add(pb.clone().multiplyScalar(Math.sin(u * winkel))).divideScalar(Math.sin(winkel) || 1);
      punkte.push(v.normalize().multiplyScalar(R * (1.01 + Math.sin(Math.PI * u) * Math.min(0.35, winkel * 0.25))));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(punkte),
      new THREE.LineBasicMaterial({ color: '#7fb6ff', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  }

  function orteSetzen(liste) {
    orteLeeren();
    (liste || []).filter((o) => Number.isFinite(+o.lat) && Number.isFinite(+o.lon)).slice(0, 12).forEach((o, i, alle) => {
      const pos = aufKugel(+o.lat, +o.lon, R * 1.01);
      const punkt = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color('#ffd27a'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      punkt.position.copy(pos); punkt.scale.setScalar(0.55); punkt.renderOrder = 5;
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color('#ffb547'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.copy(pos); ring.renderOrder = 5;
      const strahl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pos, aufKugel(+o.lat, +o.lon, R * 1.22)]),
        new THREE.LineBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      ortGruppe.add(punkt, ring, strahl);
      if (i > 0) ortGruppe.add(bogen(aufKugel(+alle[i - 1].lat, +alle[i - 1].lon), pos));
      const label = document.createElement('div');
      label.className = 'globus-label';
      label.textContent = o.name;
      document.body.appendChild(label);
      orte.push({ name: String(o.name || ''), text: String(o.text || ''), lat: +o.lat, lon: +o.lon, pos, punkt, ring, strahl, label, ringAlter: 0 });
    });
  }

  // ---------- Kamera ----------
  /** Abstand so, dass die Kugel auch im Hochformat (Handy) ganz ins Bild passt. */
  function abstandFuer(basis, fuellen) {
    const halbBreite = Math.tan(camera.fov * D / 2) * Math.min(1, camera.aspect);
    return Math.max(basis, R / (fuellen * halbBreite));
  }
  let aktiv = false, festgehalten = false, sollRichtung = null, sollAbstand = 0;
  let gespeichert = null, letzterSatz = 0, autoTimer = null, endeTimer = null, stimmeLaeuft = false;

  function zuOrt(i) {
    if (!orte[i]) return;
    aktuell = i;
    orte[i].punkt.updateMatrixWorld(true);
    sollRichtung = orte[i].punkt.getWorldPosition(new THREE.Vector3()).normalize();
    sollAbstand = abstandFuer(ABSTAND_ORT, 1.05);
    orte[i].ringAlter = 0;
    karte.hidden = false;
    karte.querySelector('.globus-name').textContent = orte[i].name;
    karte.querySelector('.globus-text').textContent = orte[i].text;
    karte.querySelector('.globus-zahl').textContent = orte.length > 1 ? `${i + 1} / ${orte.length}` : '';
  }

  function zeigen(liste, { dauerhaft = false } = {}) {
    orteSetzen(liste);
    festgehalten = dauerhaft;
    clearTimeout(endeTimer); clearInterval(autoTimer);
    if (!aktiv) {
      aktiv = true;
      gespeichert = { pos: camera.position.clone(), target: controls.target.clone(), min: controls.minDistance, max: controls.maxDistance };
      wolkeAusblenden(true);
      gruppe.visible = true;
      document.body.classList.add('globus-an');
      controls.target.set(0, 0, 0);
      controls.minDistance = 7; controls.maxDistance = 60;
      camera.position.setLength(abstandFuer(ABSTAND_UEBERSICHT, 0.8));
      controls.autoRotate = false;
    }
    karte.hidden = !orte.length && !dauerhaft;
    if (!orte.length) {
      karte.hidden = false;
      karte.querySelector('.globus-name').textContent = 'Die Erde';
      karte.querySelector('.globus-text').textContent = 'Ziehen zum Drehen, zoomen mit Mausrad oder zwei Fingern.';
      karte.querySelector('.globus-zahl').textContent = '';
      sollRichtung = aufKugel(48, 10).normalize(); sollAbstand = abstandFuer(ABSTAND_UEBERSICHT, 0.8); // Europa im Blick
      return;
    }
    zuOrt(0);
    // Ohne passende Sätze (z. B. Stimme aus) weiter im Takt
    autoTimer = setInterval(() => {
      if (festgehalten || stimmeLaeuft && Date.now() - letzterSatz < TAKT_OHNE_STIMME) return;
      if (aktuell < orte.length - 1) zuOrt(aktuell + 1);
      else { clearInterval(autoTimer); if (!stimmeLaeuft) planeEnde(); }
    }, TAKT_OHNE_STIMME);
  }

  function planeEnde() {
    clearTimeout(endeTimer);
    endeTimer = setTimeout(() => { if (!festgehalten) verlassen(); }, NACHLAUF_MS);
  }

  function verlassen() {
    if (!aktiv) return;
    aktiv = false;
    clearTimeout(endeTimer); clearInterval(autoTimer);
    gruppe.visible = false;
    karte.hidden = true;
    orteLeeren();
    document.body.classList.remove('globus-an');
    wolkeAusblenden(false);
    if (gespeichert) {
      camera.position.copy(gespeichert.pos); controls.target.copy(gespeichert.target);
      controls.minDistance = gespeichert.min; controls.maxDistance = gespeichert.max;
    }
    controls.autoRotate = !reduziert;
  }

  // MO spricht einen Satz → zum darin genannten Ort drehen
  window.addEventListener('mo:satz', (ev) => {
    if (!aktiv || !orte.length) return;
    stimmeLaeuft = true; clearTimeout(endeTimer);
    const satz = String(ev.detail || '').toLowerCase();
    const i = orte.findIndex((o, k) => k !== aktuell && o.name && satz.includes(o.name.toLowerCase().split(/[ ,(]/)[0]));
    if (i >= 0) { letzterSatz = Date.now(); if (!festgehalten) zuOrt(i); }
  });
  window.addEventListener('mo:fertig', () => { stimmeLaeuft = false; if (aktiv && orte.length) planeEnde(); });
  // Wer selbst dreht, behält die Kugel, bis er „Zurück zur Wolke“ wählt
  controls.addEventListener('start', () => { if (aktiv) { festgehalten = true; sollRichtung = null; } });

  // ---------- Bild für Bild ----------
  const v = new THREE.Vector3(), blick = new THREE.Vector3();
  let letztesT = 0;
  function schritt(t, stoss = 0) {
    if (!aktiv) return;
    // zeitbasiert, damit die Kugel auch bei wenigen Bildern pro Sekunde (schwaches Handy) ankommt
    const dt = Math.min(0.5, Math.max(0, t - letztesT) || 1 / 60);
    letztesT = t;
    const anteil = reduziert ? 1 : 1 - Math.exp(-dt * 2.8);
    if (sollRichtung) {
      const abstand = camera.position.length();
      const richtung = camera.position.clone().normalize();
      const neu = richtung.lerp(sollRichtung, anteil).normalize();
      camera.position.copy(neu.multiplyScalar(abstand + (sollAbstand - abstand) * anteil));
      if (richtung.angleTo(sollRichtung) < 0.002 && Math.abs(sollAbstand - abstand) < 0.05) sollRichtung = null;
    } else if (!festgehalten && !reduziert && !orte.length) {
      gruppe.rotation.y += dt * 0.05; // ganz langsames Weiterdrehen
    }
    atmo.material.opacity = 0.24 + stoss * 0.18; // die Atmosphäre atmet mit MOs Stimme
    blick.copy(camera.position).normalize();
    for (let i = 0; i < orte.length; i++) {
      const o = orte[i], an = i === aktuell;
      o.punkt.scale.setScalar(an ? 0.9 + Math.sin(t * 6) * 0.15 : 0.5);
      o.ringAlter += dt;
      const u = (o.ringAlter % 1.6) / 1.6;
      o.ring.scale.setScalar(0.6 + u * (an ? 3.2 : 1.6));
      o.ring.material.opacity = (1 - u) * (an ? 0.9 : 0.3);
      o.punkt.getWorldPosition(v);
      const vorne = v.clone().normalize().dot(blick) > 0.15;
      v.project(camera);
      o.label.style.opacity = vorne && v.z < 1 ? (an ? '1' : '0.55') : '0';
      o.label.classList.toggle('an', an);
      o.label.style.left = ((v.x + 1) / 2 * window.innerWidth) + 'px';
      o.label.style.top = ((1 - v.y) / 2 * window.innerHeight) + 'px';
    }
  }

  return { schritt, zeigen, verlassen, get aktiv() { return aktiv; } };
}
