/* Todo Studio – Jarvis als Weltraumnebel (violett), Sub-Agenten als helle Partikel darin.
   Die Fach-Bereiche hängen als Sternhaufen an Nebelarmen am Kern; arbeitende Agenten sind über
   leuchtende Synapsen mit Jarvis verbunden, auf denen Signale wandern.
   Three.js mit Leuchteffekt (Bloom). Zoom per Mausrad / Zwei-Finger-Geste, Partikel antippen für Details. */

const canvas = document.getElementById('wolke');
const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const schwach = (navigator.hardwareConcurrency || 4) <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 700;

// Sub-Agenten bewusst neutral (Weiß/Eisblau) – Violett gehört dem Hauptagenten
const FARBEN = {
  bereit: '#dfe7f5', arbeitet: '#ffffff', denkt: '#ffffff', laeuft: '#ffffff', wartet: '#fbbf24', meldet: '#fbbf24',
  fehler: '#fb7185', haengt: '#fb7185', fertig: '#4ade80', getrennt: '#5c6270', gestoppt: '#8a909c', abgebrochen: '#fbbf24'
};
const AKTIV = new Set(['arbeitet', 'denkt', 'laeuft', 'wartet', 'meldet', 'haengt']);

function streuwert(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// ---------- 3D-Rauschen für eine natürliche Nebelform ----------
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function rauschen(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
function fbm(x, y, z) {
  let summe = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 5; o++) { summe += amp * rauschen(x * f, y * f, z * f); f *= 2.03; amp *= 0.5; }
  return summe;
}
/** Dichte des Nebels: weiche Kugel, durch Rauschen zu Schwaden und Fasern geformt */
function dichte(x, y, z) {
  const r2 = x * x + (y * 1.6) * (y * 1.6) + z * z;
  const huelle = Math.exp(-r2 / 70);
  const n = fbm(x * 0.16 + 3.1, y * 0.16 + 7.7, z * 0.16 + 1.3);
  const faden = Math.pow(Math.max(0, n - 0.32) / 0.68, 1.7);
  return huelle * (0.15 + faden * 1.6);
}

let api;

try {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
  const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
  const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, schwach ? 1.25 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#04050a');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800);
  camera.position.set(6, 7, 34);

  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.07, enablePan: false, minDistance: 2.5, maxDistance: 95,
    rotateSpeed: 0.5, zoomSpeed: 0.9, autoRotate: !reduziert, autoRotateSpeed: 0.22
  });

  // ---------- Texturen ----------
  function leuchtTextur() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,.9)');
    r.addColorStop(0.4, 'rgba(255,255,255,.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function gasTextur() { // weiche, unregelmäßige Wolkenflocke
    const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), bild = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x - n / 2) / (n / 2), dy = (y - n / 2) / (n / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const f = fbm(x * 0.06, y * 0.06, 4.2);
      const a = Math.max(0, 1 - d) ** 1.6 * (0.35 + f * 1.1);
      const i = (y * n + x) * 4;
      bild.data[i] = bild.data[i + 1] = bild.data[i + 2] = 255;
      bild.data[i + 3] = Math.min(255, a * 255);
    }
    g.putImageData(bild, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const LEUCHT = leuchtTextur();
  const GAS = gasTextur();

  const nebel = new THREE.Group();
  scene.add(nebel);

  // Punkte nach Dichte verteilen (Verwerfungsverfahren)
  function verteilen(anzahl, radius, schwelle) {
    const punkte = [];
    let versuche = 0;
    while (punkte.length < anzahl && versuche < anzahl * 60) {
      versuche++;
      const x = (Math.random() * 2 - 1) * radius, y = (Math.random() * 2 - 1) * radius * 0.7, z = (Math.random() * 2 - 1) * radius;
      const d = dichte(x, y, z);
      if (Math.random() < d * schwelle) punkte.push([x, y, z, d]);
    }
    return punkte;
  }

  // Farbverlauf: heller Kern → Magenta → Violett → tiefes Indigo am Rand
  const FARB_STUFEN = ['#f5d0fe', '#d46ef0', '#a855f7', '#7c3aed', '#4c2fb0', '#231d63'].map((h) => new THREE.Color(h));
  const BLAU = new THREE.Color('#4f6dff');
  const ROSA = new THREE.Color('#ff6fcf');
  function nebelFarbe(x, y, z, ziel) {
    const r = Math.sqrt(x * x + y * y + z * z);
    const t = Math.min(0.999, r / 11) * (FARB_STUFEN.length - 1);
    const i = Math.floor(t);
    ziel.copy(FARB_STUFEN[i]).lerp(FARB_STUFEN[i + 1], t - i);
    const tönung = rauschen(x * 0.18 + 11, y * 0.18, z * 0.18);
    if (tönung > 0.58) ziel.lerp(BLAU, Math.min(0.7, (tönung - 0.58) * 1.8));
    const glut = rauschen(x * 0.3 + 23, y * 0.3 + 5, z * 0.3);
    if (glut > 0.66 && r < 8) ziel.lerp(ROSA, (glut - 0.66) * 1.6);
    return ziel;
  }

  // Gemeinsamer Shader für Gas und Sternenstaub (sanfte Drehung, Atmen beim Denken/Sprechen)
  function punktMaterial({ textur, additiv = true, skala, alphaFaktor, drehen = true }) {
    return new THREE.ShaderMaterial({
      uniforms: { uZeit: { value: 0 }, uPuls: { value: 0 }, uPixel: { value: pixelRatio }, uTex: { value: textur }, uFunkeln: { value: reduziert ? 0 : 1 }, uDrehen: { value: drehen ? 1 : 0 } },
      vertexShader: `
        attribute vec3 farbe; attribute float groesse; attribute float phase; attribute float alpha;
        uniform float uZeit; uniform float uPuls; uniform float uPixel; uniform float uFunkeln; uniform float uDrehen;
        varying vec3 vFarbe; varying float vAlpha; varying float vDreh;
        void main() {
          vec3 p = position;
          float r = length(p.xz);
          float w = uZeit * (0.025 + 0.06 / (1.0 + r * 0.4)) * uDrehen;
          p.xz = mat2(cos(w), -sin(w), sin(w), cos(w)) * p.xz;
          p += 0.15 * vec3(sin(uZeit * 0.3 + phase), cos(uZeit * 0.25 + phase * 1.3), sin(uZeit * 0.2 + phase * 0.7));
          p *= 1.0 + uPuls * 0.035 * sin(uZeit * 5.0 + r * 0.8);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = groesse * uPixel * (${skala.toFixed(1)} / -mv.z) * (1.0 + uPuls * 0.15);
          vFarbe = farbe;
          vAlpha = alpha * (0.85 + 0.15 * sin(uZeit * 1.3 + phase) * uFunkeln) * (1.0 + uPuls * ${alphaFaktor.toFixed(2)});
          vDreh = phase + uZeit * 0.05;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vFarbe; varying float vAlpha; varying float vDreh;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          c = mat2(cos(vDreh), -sin(vDreh), sin(vDreh), cos(vDreh)) * c + 0.5;
          vec4 t = texture2D(uTex, c);
          gl_FragColor = vec4(vFarbe * t.rgb, t.a * vAlpha);
        }`,
      transparent: true, depthWrite: false, blending: additiv ? THREE.AdditiveBlending : THREE.NormalBlending
    });
  }

  function punkteWolke(punkte, { groesse, alpha, farbe }, material, gruppe = nebel) {
    const n = punkte.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), gr = new Float32Array(n), ph = new Float32Array(n), al = new Float32Array(n);
    const c = new THREE.Color();
    punkte.forEach(([x, y, z, d], i) => {
      pos.set([x, y, z], i * 3);
      farbe(x, y, z, d, c); col.set([c.r, c.g, c.b], i * 3);
      gr[i] = groesse(d); ph[i] = Math.random() * Math.PI * 2; al[i] = alpha(d, x, y, z);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('farbe', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('groesse', new THREE.BufferAttribute(gr, 1));
    geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(al, 1));
    const p = new THREE.Points(geo, material);
    gruppe.add(p);
    return p;
  }

  // 1) Gasschwaden – große, weiche Flocken ergeben das Volumen
  const gasMat = punktMaterial({ textur: GAS, skala: 260, alphaFaktor: 0.35 });
  const gas = punkteWolke(verteilen(schwach ? 500 : 1100, 17, 1.6), {
    groesse: (d) => 4 + Math.random() * 8 + d * 3,
    alpha: (d) => 0.016 + Math.min(0.07, d * 0.05),
    farbe: (x, y, z, d, c) => nebelFarbe(x, y, z, c).multiplyScalar(0.85)
  }, gasMat);

  // 2) Dunkle Staubbahnen – geben Tiefe und Kontrast
  const staubMat = punktMaterial({ textur: GAS, additiv: false, skala: 260, alphaFaktor: 0 });
  const staub = punkteWolke(verteilen(schwach ? 70 : 160, 14, 1.2).filter(([x, y, z]) => rauschen(x * 0.25 + 40, y * 0.25, z * 0.25) > 0.55), {
    groesse: () => 6 + Math.random() * 8,
    alpha: () => 0.4 + Math.random() * 0.25,
    farbe: (x, y, z, d, c) => c.set('#06040f')
  }, staubMat);
  staub.renderOrder = 1;

  // 3) Feiner Sternenstaub – funkelnde Körnchen im Nebel
  const kornMat = punktMaterial({ textur: LEUCHT, skala: 40, alphaFaktor: 0.4 });
  const korn = punkteWolke(verteilen(schwach ? 2600 : 6500, 16, 2.2), {
    groesse: () => 0.5 + Math.random() ** 4 * 3.2,
    alpha: (d) => 0.22 + Math.min(0.4, d * 0.3),
    farbe: (x, y, z, d, c) => nebelFarbe(x * 0.8, y * 0.8, z * 0.8, c).lerp(new THREE.Color('#ffffff'), 0.25)
  }, kornMat);
  korn.renderOrder = 2;

  // 4) Hintergrundsterne
  const STERNE = schwach ? 900 : 2200;
  const sternPos = new Float32Array(STERNE * 3), sternFarbe = new Float32Array(STERNE * 3);
  const sc = new THREE.Color();
  for (let i = 0; i < STERNE; i++) {
    const r = 120 + Math.random() * 200, t = Math.random() * Math.PI * 2, f = Math.acos(2 * Math.random() - 1);
    sternPos.set([r * Math.sin(f) * Math.cos(t), r * Math.cos(f), r * Math.sin(f) * Math.sin(t)], i * 3);
    sc.setHSL(0.58 + Math.random() * 0.1, 0.3, 0.75 + Math.random() * 0.25);
    sternFarbe.set([sc.r, sc.g, sc.b], i * 3);
  }
  const sternGeo = new THREE.BufferGeometry();
  sternGeo.setAttribute('position', new THREE.BufferAttribute(sternPos, 3));
  sternGeo.setAttribute('color', new THREE.BufferAttribute(sternFarbe, 3));
  scene.add(new THREE.Points(sternGeo, new THREE.PointsMaterial({ size: 0.9, map: LEUCHT, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })));

  // 5) Kern = Jarvis
  const kern = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color('#fff4ff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  kern.scale.setScalar(2.6);
  kern.renderOrder = 3;
  kern.userData.agent = { id: 'jarvis', name: 'Jarvis', aufgabe: 'Hauptagent und Ihr einziger Ansprechpartner. Verteilt Arbeit an die Sub-Agenten und holt vor allem mit Folgen Ihre Freigabe ein.', status: 'bereit' };
  scene.add(kern);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color('#7c4dff'), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(11);
  scene.add(halo);

  // ---------- Sub-Agenten ----------
  const agentenGruppe = new THREE.Group();
  scene.add(agentenGruppe);
  const sprites = new Map();
  let jarvisStatus = 'bereit';
  let spricht = false, hoert = false, ausgewaehlt = null, ueber = null;

  function agentAnlegen(a) {
    const zufall = streuwert(a.id);
    const istSitzung = a.art === 'sitzung';
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color(FARBEN[a.status] || FARBEN.bereit), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.renderOrder = 4;
    agentenGruppe.add(sprite);
    const label = document.createElement('div');
    label.className = 'agent-label';
    label.style.opacity = '0';
    document.body.appendChild(label);
    const e = {
      sprite, label, daten: a, winkel: zufall * Math.PI * 2, radius: istSitzung ? 10 + zufall * 2.5 : 4.8 + zufall * 3.4,
      hoehe: (streuwert(a.id + 'h') - 0.5) * (istSitzung ? 5 : 3.5), tempo: (istSitzung ? 0.04 : 0.07) * (0.7 + streuwert(a.id + 't') * 0.6)
    };
    sprite.userData.eintrag = e;
    sprites.set(a.id, e);
    return e;
  }

  function setzeAgenten(liste, jarvis) {
    jarvisStatus = (jarvis && jarvis.status) || 'bereit';
    Object.assign(kern.userData.agent, { status: jarvisStatus, letzteAktion: jarvis && jarvis.letzteAktion, zuletzt: jarvis && jarvis.zuletzt });
    const ids = new Set();
    for (const a of liste || []) {
      ids.add(a.id);
      const e = sprites.get(a.id) || agentAnlegen(a);
      e.daten = a;
      e.sprite.material.color.set(FARBEN[a.status] || FARBEN.bereit);
      e.label.textContent = a.name;
    }
    for (const [id, e] of sprites) {
      if (!ids.has(id)) { agentenGruppe.remove(e.sprite); e.sprite.material.dispose(); e.label.remove(); sprites.delete(id); }
    }
  }

  // ---------- Fach-Agenten: ein Sternhaufen je Bereich (neutral – Violett bleibt Jarvis) ----------
  const haufenGruppe = new THREE.Group();
  scene.add(haufenGruppe);
  const fach = new Map();      // agentId -> { sprite, label, daten, basis }
  const haufen = new Map();    // bereichId -> { mitte, label, glanz }
  let aktiveFach = {};
  let kameraZiel = null;

  function fibonacci(i, n) {
    const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5));
    return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r);
  }

  // Nebelarme: Gas und Sternenstaub vom Kern zu jedem Bereich – alles gehört sichtbar zu einer Wolke
  const armGasMat = punktMaterial({ textur: GAS, skala: 260, alphaFaktor: 0.25, drehen: false });
  const armKornMat = punktMaterial({ textur: LEUCHT, skala: 40, alphaFaktor: 0.3, drehen: false });
  const ARM_FARBEN = ['#8b5cf6', '#5b5bf0', '#3f63e0', '#2c4bb8'].map((h) => new THREE.Color(h)); // Violett am Kern → kühles Blau außen
  let armTeile = [];

  function armFarbe(anteil, ziel) {
    const t = Math.min(0.999, anteil) * (ARM_FARBEN.length - 1), i = Math.floor(t);
    return ziel.copy(ARM_FARBEN[i]).lerp(ARM_FARBEN[i + 1], t - i);
  }

  /** Bogen vom Kern zum Bereich (leicht geschwungen, je Bereich anders) */
  function armBogen(mitte, id) {
    const seite = new THREE.Vector3(-mitte.z, 0, mitte.x).normalize().multiplyScalar((streuwert(id + 'b') - 0.5) * 6);
    const kontrolle = mitte.clone().multiplyScalar(0.5).add(seite).add(new THREE.Vector3(0, (streuwert(id + 'y') - 0.5) * 3, 0));
    return new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), kontrolle, mitte.clone());
  }

  function armeBauen(liste) {
    for (const o of armTeile) { haufenGruppe.remove(o); o.geometry.dispose(); if (o.material !== armGasMat && o.material !== armKornMat) o.material.dispose(); }
    armTeile = [];
    const gasPunkte = [], kornPunkte = [];
    const zufall = (a) => (Math.random() * 2 - 1) * a;
    for (const { mitte, id } of liste) {
      const bogen = armBogen(mitte, id);
      // Gas entlang des Arms (dichter am Haufen) und als Hülle um den Haufen
      const nArm = schwach ? 9 : 20, nHuelle = schwach ? 12 : 26, nKorn = schwach ? 26 : 70;
      for (let i = 0; i < nArm; i++) { const u = 0.3 + Math.random() * 0.7, q = bogen.getPoint(u), b = 0.8 + u * 1.6; gasPunkte.push([q.x + zufall(b), q.y + zufall(b * 0.6), q.z + zufall(b), u]); }
      for (let i = 0; i < nHuelle; i++) gasPunkte.push([mitte.x + zufall(2.6), mitte.y + zufall(1.8), mitte.z + zufall(2.6), 1]);
      for (let i = 0; i < nKorn; i++) { const u = Math.random() ** 0.6, q = bogen.getPoint(u), b = 0.4 + u * 1.8; kornPunkte.push([q.x + zufall(b), q.y + zufall(b * 0.6), q.z + zufall(b), u]); }
      // Feine Faser: zeigt die Zugehörigkeit zum Kern, auch wenn gerade niemand arbeitet
      const faser = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bogen.getPoints(40)),
        new THREE.LineBasicMaterial({ color: '#8fa3ff', transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending }));
      faser.renderOrder = 2;
      haufenGruppe.add(faser);
      armTeile.push(faser);
    }
    armTeile.push(punkteWolke(gasPunkte, {
      groesse: () => 3 + Math.random() * 6,
      alpha: (u) => 0.012 + u * 0.022,
      farbe: (x, y, z, u, c) => armFarbe(u, c).multiplyScalar(0.9)
    }, armGasMat, haufenGruppe));
    armTeile.push(punkteWolke(kornPunkte, {
      groesse: () => 0.4 + Math.random() ** 4 * 2.4,
      alpha: (u) => 0.16 + (1 - u) * 0.18,
      farbe: (x, y, z, u, c) => armFarbe(u, c).lerp(new THREE.Color('#ffffff'), 0.35)
    }, armKornMat, haufenGruppe));
  }

  function setzeKatalog(k) {
    for (const e of fach.values()) { haufenGruppe.remove(e.sprite); e.sprite.material.dispose(); if (e.label) e.label.remove(); }
    for (const h of haufen.values()) { haufenGruppe.remove(h.glanz); h.label.remove(); }
    fach.clear(); haufen.clear();
    const bereiche = k.bereiche || [];
    const arme = [];
    bereiche.forEach((b, i) => {
      const richtung = fibonacci(i, bereiche.length);
      // Näher am Kern als früher (24 → 15): die Haufen sitzen am Rand derselben Wolke
      const mitte = new THREE.Vector3(richtung.x * 15, richtung.y * 8, richtung.z * 15);
      arme.push({ mitte, id: b.id });
      const glanz = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color('#9fb4ff'), transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
      glanz.position.copy(mitte); glanz.scale.setScalar(6);
      haufenGruppe.add(glanz);
      const label = document.createElement('div');
      label.className = 'bereich-label'; label.textContent = b.name; label.style.opacity = '0';
      document.body.appendChild(label);
      haufen.set(b.id, { mitte, label, glanz });
      b.agenten.forEach((a, n) => {
        const p = fibonacci(n, Math.max(b.agenten.length, 2)).multiplyScalar(1.2 + (n % 3) * 0.55).add(mitte);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: new THREE.Color(a.leitung ? '#ffffff' : '#cfd9ee'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sprite.position.copy(p);
        const basis = a.leitung ? 0.55 : 0.36;
        sprite.scale.setScalar(basis);
        sprite.renderOrder = 4;
        sprite.userData.fachId = a.id;
        haufenGruppe.add(sprite);
        fach.set(a.id, { sprite, label: null, daten: a, basis, bereich: b.id });
      });
    });
    armeBauen(arme);
    setzeAktive(aktiveFach);
  }

  // ---------- Synapsen: leuchtende Verbindungen vom Kern zu allem, was gerade arbeitet ----------
  const synapsenGruppe = new THREE.Group();
  scene.add(synapsenGruppe);
  const synapsen = new Map(); // schluessel -> { linie, signale, staerke, soll, ziel(), via(), ende? }
  const PUNKTE = 36;
  const SYN_FARBE = new THREE.Color('#7fd4ff'), SYN_WARN = new THREE.Color('#fbbf24'), SYN_FEHLER = new THREE.Color('#fb7185');
  let blitzNr = 0, naechsterBlitz = 0;

  function synapseAnlegen(schluessel, ziel, via, farbe) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUNKTE * 3), 3));
    const linie = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: farbe || SYN_FARBE, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    linie.renderOrder = 5;
    synapsenGruppe.add(linie);
    const perlen = new THREE.Points(geo, new THREE.PointsMaterial({ map: LEUCHT, color: farbe || SYN_FARBE, size: 0.32, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    perlen.renderOrder = 5;
    synapsenGruppe.add(perlen);
    const signale = [0, 1, 2].map((i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEUCHT, color: farbe || '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(0.6); sp.renderOrder = 6; synapsenGruppe.add(sp);
      return { sp, versatz: i / 3 };
    });
    const syn = { linie, perlen, signale, staerke: 0, soll: 1, ziel, via, farbe: farbe || SYN_FARBE, tempo: 0.45 + streuwert(schluessel) * 0.3 };
    synapsen.set(schluessel, syn);
    return syn;
  }

  function synapseEntfernen(schluessel, syn) {
    synapsenGruppe.remove(syn.linie); synapsenGruppe.remove(syn.perlen); syn.linie.geometry.dispose(); syn.linie.material.dispose(); syn.perlen.material.dispose();
    for (const s of syn.signale) { synapsenGruppe.remove(s.sp); s.sp.material.dispose(); }
    synapsen.delete(schluessel);
  }

  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vK = new THREE.Vector3(), KERN_POS = new THREE.Vector3(0, 0, 0);
  const bogenTmp = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());

  /** Welche Verbindungen sollen gerade leuchten? */
  function synapsenSoll(t) {
    const soll = new Map();
    for (const [id, e] of sprites) {
      const st = e.daten.status;
      if (!AKTIV.has(st)) continue;
      soll.set('a:' + id, { ziel: (v) => e.sprite.getWorldPosition(v), via: null, farbe: st === 'wartet' || st === 'meldet' ? SYN_WARN : st === 'haengt' ? SYN_FEHLER : null });
    }
    for (const [id, st] of Object.entries(aktiveFach)) {
      const e = fach.get(id);
      if (!e || !AKTIV.has(st)) continue;
      const hf = haufen.get(e.bereich);
      soll.set('f:' + id, { ziel: (v) => e.sprite.getWorldPosition(v), via: hf ? (v) => v.copy(hf.mitte).applyMatrix4(haufenGruppe.matrixWorld) : null, farbe: st === 'wartet' ? SYN_WARN : null });
    }
    return soll;
  }

  function synapsenAktualisieren(t) {
    const soll = synapsenSoll(t);
    for (const [k, d] of soll) {
      const syn = synapsen.get(k) || synapseAnlegen(k, d.ziel, d.via, d.farbe);
      syn.soll = 1; syn.ziel = d.ziel; syn.via = d.via;
    }
    // Gedankenblitze, solange Jarvis über Ihre Nachricht nachdenkt: kurze Impulse in die Bereiche
    if (jarvisStatus === 'denkt' && !reduziert && t > naechsterBlitz && fach.size) {
      naechsterBlitz = t + 0.35 + Math.random() * 0.45;
      const alle = [...fach.values()];
      const e = alle[Math.floor(Math.random() * alle.length)];
      const hf = haufen.get(e.bereich);
      const syn = synapseAnlegen('b:' + (blitzNr++), (v) => e.sprite.getWorldPosition(v), hf ? (v) => v.copy(hf.mitte).applyMatrix4(haufenGruppe.matrixWorld) : null, new THREE.Color('#d9c8ff'));
      syn.ende = t + 0.9; syn.tempo = 1.4; syn.blitz = true;
    }
    for (const [k, syn] of synapsen) {
      if (syn.blitz) syn.soll = t < syn.ende ? 1 : 0;
      else if (!soll.has(k)) syn.soll = 0;
      syn.staerke += (syn.soll - syn.staerke) * (syn.blitz ? 0.25 : 0.08);
      if (syn.soll === 0 && syn.staerke < 0.02) { synapseEntfernen(k, syn); continue; }
      syn.ziel(vB);
      if (syn.via) { syn.via(vK); vK.lerp(vB, 0.15); } else vK.copy(vB).multiplyScalar(0.5).add(vA.set(0, 1.6, 0));
      bogenTmp.v0.copy(KERN_POS); bogenTmp.v1.copy(vK); bogenTmp.v2.copy(vB);
      const pos = syn.linie.geometry.attributes.position;
      for (let i = 0; i < PUNKTE; i++) { bogenTmp.getPoint(i / (PUNKTE - 1), vA); pos.setXYZ(i, vA.x, vA.y, vA.z); }
      pos.needsUpdate = true;
      syn.linie.geometry.computeBoundingSphere();
      const flackern = syn.blitz ? 1 : 0.8 + Math.sin(t * 7 + syn.tempo * 10) * 0.2;
      syn.linie.material.opacity = syn.staerke * (syn.blitz ? 0.55 : 0.6) * flackern;
      syn.perlen.material.opacity = syn.staerke * (syn.blitz ? 0.35 : 0.45) * flackern;
      // Signale wandern vom Kern zum Agenten (Jarvis schickt Arbeit) – beim Blitz nur eines
      syn.signale.forEach((s, i) => {
        if (syn.blitz && i > 0) { s.sp.material.opacity = 0; return; }
        const u = reduziert ? 0.5 : (t * syn.tempo + s.versatz) % 1;
        bogenTmp.getPoint(u, s.sp.position);
        s.sp.material.opacity = syn.staerke * Math.sin(u * Math.PI) * 0.95;
      });
    }
  }

  function setzeAktive(map) {
    aktiveFach = map || {};
    for (const [id, e] of fach) {
      const st = aktiveFach[id];
      e.sprite.material.color.set(st ? (FARBEN[st] || '#ffffff') : (e.daten.leitung ? '#ffffff' : '#cfd9ee'));
    }
  }

  function fokus(id) {
    const e = fach.get(id);
    if (!e) return;
    ausgewaehlt = e.sprite;
    const ziel = new THREE.Vector3();
    e.sprite.getWorldPosition(ziel);
    const richtung = camera.position.clone().sub(controls.target).normalize();
    kameraZiel = ziel.clone().add(richtung.multiplyScalar(6));
    setTimeout(() => {
      const v2 = ziel.clone().project(camera);
      if (window.Jarvis) Jarvis.agentKarte(Jarvis.agentZuKarte(id), (v2.x + 1) / 2 * window.innerWidth, (1 - v2.y) / 2 * window.innerHeight);
    }, 1200);
  }

  function haufenBeschriften(abstand) {
    const w = window.innerWidth, h = window.innerHeight, v3 = new THREE.Vector3();
    for (const hf of haufen.values()) {
      v3.copy(hf.mitte).applyMatrix4(haufenGruppe.matrixWorld);
      const entfernung = camera.position.distanceTo(v3);
      v3.project(camera);
      const sichtbar = v3.z < 1 && entfernung < 26 && entfernung > 3;
      if (sichtbar) { hf.label.style.left = ((v3.x + 1) / 2 * w) + 'px'; hf.label.style.top = ((1 - v3.y) / 2 * h - 34) + 'px'; }
      hf.label.style.opacity = sichtbar ? String(Math.min(1, (26 - entfernung) / 8)) : '0';
    }
    for (const e of fach.values()) {
      const st = aktiveFach[e.daten.id];
      const puls = st === 'arbeitet' ? 1 + Math.sin(performance.now() / 160) * 0.35 : 1;
      e.sprite.scale.setScalar(e.basis * puls * (ausgewaehlt === e.sprite ? 1.9 : st ? 1.5 : 1));
      e.sprite.getWorldPosition(v3);
      const nah = camera.position.distanceTo(v3) < 8.5;
      const zeigen = nah || ueber === e.sprite || ausgewaehlt === e.sprite;
      if (zeigen && !e.label) {
        e.label = document.createElement('div');
        e.label.className = 'agent-label';
        e.label.textContent = e.daten.name;
        document.body.appendChild(e.label);
      }
      if (!e.label) continue;
      v3.project(camera);
      const sichtbar = zeigen && v3.z < 1;
      if (sichtbar) { e.label.style.left = ((v3.x + 1) / 2 * w) + 'px'; e.label.style.top = ((1 - v3.y) / 2 * h) + 'px'; }
      e.label.style.opacity = sichtbar ? '1' : '0';
    }
  }

  // ---------- Leuchteffekt ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), schwach ? 0.6 : 0.75, 0.55, 0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let mitBloom = true;

  function groesseAnpassen() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    bloom.resolution.set(w * (schwach ? 0.35 : 0.5), h * (schwach ? 0.35 : 0.5));
    camera.aspect = w / h;
    if (w > 860) camera.setViewOffset(w, h, (Math.min(420, w - 32) + 16) / 2, 0, w, h);
    else camera.setViewOffset(w, h, 0, Math.round(h * 0.2), w, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', groesseAnpassen);
  groesseAnpassen();

  // ---------- Auswahl ----------
  const ray = new THREE.Raycaster();
  const zeiger = new THREE.Vector2();
  let start = null;
  function treffer(ev) {
    const rect = canvas.getBoundingClientRect();
    zeiger.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    zeiger.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(zeiger, camera);
    const ziele = [...sprites.values()].map((e) => e.sprite).concat([...fach.values()].map((e) => e.sprite), [kern]);
    const t = ray.intersectObjects(ziele, false)[0];
    if (t) return t.object;
    // Fingerfreundlich: nächstgelegene Partikel im Umkreis von ~28 px (Handy) bzw. 16 px (Maus)
    const radius = ev.pointerType === 'mouse' ? 16 : 28;
    let bestes = null, bestAbstand = radius;
    const p = new THREE.Vector3();
    for (const s of ziele) {
      s.getWorldPosition(p);
      p.project(camera);
      if (p.z > 1) continue;
      const x = (p.x + 1) / 2 * rect.width + rect.left, y = (1 - p.y) / 2 * rect.height + rect.top;
      const d = Math.hypot(x - ev.clientX, y - ev.clientY);
      if (d < bestAbstand) { bestAbstand = d; bestes = s; }
    }
    return bestes;
  }
  canvas.addEventListener('pointerdown', (ev) => { start = { x: ev.clientX, y: ev.clientY }; });
  canvas.addEventListener('pointerup', (ev) => {
    if (!start) return;
    const bewegt = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
    start = null;
    if (bewegt > 8) return;
    const obj = treffer(ev);
    if (!obj) { auswahlAufheben(); return; }
    ausgewaehlt = obj;
    kameraZiel = null;
    if (obj.userData.fachId) { if (window.Jarvis) Jarvis.agentKarte(Jarvis.agentZuKarte(obj.userData.fachId), ev.clientX, ev.clientY); return; }
    const agent = obj === kern ? kern.userData.agent : obj.userData.eintrag.daten;
    if (window.Jarvis) Jarvis.agentKarte(agent, ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    ueber = treffer(ev);
    canvas.style.cursor = ueber ? 'pointer' : 'grab';
  });
  function auswahlAufheben() {
    ausgewaehlt = null;
    const k = document.getElementById('agentKarte');
    if (k) k.hidden = true;
  }

  // ---------- Animation ----------
  const uhr = new THREE.Clock();
  const ziel = new THREE.Vector3(), v = new THREE.Vector3();
  const KERN_FARBE = new THREE.Color('#fff4ff'), KERN_AUS = new THREE.Color('#5c5670'), KERN_FEHLER = new THREE.Color('#ffb4c2');
  let bilder = 0, messStart = performance.now(), stufe = 0, pulsIst = 0, helligkeit = 1;
  const materialien = [gasMat, kornMat, staubMat, armGasMat, armKornMat];

  function bild() {
    requestAnimationFrame(bild);
    if (document.hidden) return;
    const t = uhr.getElapsedTime();
    const pulsSoll = jarvisStatus === 'denkt' ? 1 : spricht ? 0.75 : hoert ? 0.5 : 0;
    pulsIst += (pulsSoll - pulsIst) * 0.05;
    helligkeit += ((jarvisStatus === 'getrennt' ? 0.45 : 1) - helligkeit) * 0.03;
    for (const m of materialien) { m.uniforms.uZeit.value = t; m.uniforms.uPuls.value = pulsIst; }
    renderer.toneMappingExposure = 0.55 + 0.5 * helligkeit;
    const atem = 1 + Math.sin(t * (1.1 + pulsIst * 4)) * (0.05 + pulsIst * 0.08);
    kern.scale.setScalar(2.6 * atem);
    kern.material.color.copy(jarvisStatus === 'getrennt' ? KERN_AUS : jarvisStatus === 'fehler' ? KERN_FEHLER : KERN_FARBE);
    halo.material.opacity = (0.25 + pulsIst * 0.25) * helligkeit;
    bloom.strength = (schwach ? 0.6 : 0.75) + pulsIst * 0.35;

    const abstand = camera.position.distanceTo(controls.target);
    for (const e of sprites.values()) {
      const w = e.winkel + (reduziert ? 0 : t * e.tempo);
      e.sprite.position.set(Math.cos(w) * e.radius, e.hoehe + Math.sin(t * 0.4 + e.winkel) * 0.3, Math.sin(w) * e.radius);
      const aktiv = AKTIV.has(e.daten.status);
      const basis = e.daten.art === 'sitzung' ? 0.95 : 0.7;
      e.sprite.scale.setScalar(basis * (aktiv ? 1 + Math.sin(t * 5 + e.winkel) * 0.3 : 1) * (ausgewaehlt === e.sprite ? 1.6 : 1));
      e.sprite.getWorldPosition(v);
      v.project(camera);
      const sichtbar = v.z < 1 && (abstand < 19 || ueber === e.sprite || ausgewaehlt === e.sprite);
      if (sichtbar) {
        e.label.style.left = ((v.x + 1) / 2 * window.innerWidth) + 'px';
        e.label.style.top = ((1 - v.y) / 2 * window.innerHeight) + 'px';
      }
      e.label.style.opacity = sichtbar ? '1' : '0';
    }
    haufenGruppe.rotation.y = reduziert ? 0 : t * 0.012;
    haufenGruppe.updateMatrixWorld();
    synapsenAktualisieren(t);
    haufenBeschriften(abstand);
    if (kameraZiel) { camera.position.lerp(kameraZiel, 0.05); if (camera.position.distanceTo(kameraZiel) < 0.3) kameraZiel = null; }
    if (ausgewaehlt) { ausgewaehlt.getWorldPosition(ziel); controls.target.lerp(ziel, 0.06); controls.autoRotate = false; }
    else { controls.target.lerp(ziel.set(0, 0, 0), 0.04); controls.autoRotate = !reduziert; }
    controls.update();
    if (mitBloom) composer.render(); else renderer.render(scene, camera);

    // Schwaches Gerät: stufenweise vereinfachen, damit alles flüssig bleibt
    bilder++;
    const jetzt = performance.now();
    if (jetzt - messStart > 2500) {
      const fps = bilder * 1000 / (jetzt - messStart);
      if (fps < 38 && stufe < 3) {
        stufe++;
        if (stufe === 1) {
          korn.geometry.setDrawRange(0, Math.floor(korn.geometry.attributes.position.count * 0.5)); gas.geometry.setDrawRange(0, Math.floor(gas.geometry.attributes.position.count * 0.6));
          for (const o of armTeile) if (o.isPoints) o.geometry.setDrawRange(0, Math.floor(o.geometry.attributes.position.count * 0.5));
        }
        if (stufe === 2) { pixelRatio = 1; renderer.setPixelRatio(1); materialien.forEach((m) => { m.uniforms.uPixel.value = 1; }); groesseAnpassen(); }
        if (stufe === 3) mitBloom = false;
      }
      bilder = 0; messStart = jetzt;
    }
  }
  bild();

  api = { setzeAgenten, setzeKatalog, setzeAktive, fokus, auswahlAufheben, setzeSpricht(b) { spricht = !!b; }, setzeHoert(b) { hoert = !!b; },
    get synapsen() { return synapsen.size; }, get bereiche() { return haufen.size; } };
} catch (err) {
  // Ohne WebGL: ruhige Ersatz-Darstellung, Agenten als antippbare Punkte im Kreis
  console.warn('Wolke ohne WebGL:', err);
  canvas.style.display = 'none';
  const ersatz = document.createElement('div');
  ersatz.className = 'wolke-ersatz';
  ersatz.innerHTML = '<div class="kern"></div>';
  document.body.appendChild(ersatz);
  const knoepfe = [];
  api = {
    setzeAgenten(liste) {
      knoepfe.forEach((k) => k.remove());
      knoepfe.length = 0;
      (liste || []).forEach((a, i, alle) => {
        const w = (i / alle.length) * Math.PI * 2;
        const k = document.createElement('button');
        k.className = 'pille';
        k.style.cssText = `position:fixed;z-index:2;left:calc(${window.innerWidth > 860 ? '40%' : '50%'} + ${Math.cos(w) * 170}px);top:calc(${window.innerWidth > 860 ? '50%' : '30%'} + ${Math.sin(w) * 120}px);transform:translate(-50%,-50%);border-color:${FARBEN[a.status] || FARBEN.bereit}`;
        k.textContent = a.name;
        k.onclick = (ev) => window.Jarvis && Jarvis.agentKarte(a, ev.clientX, ev.clientY);
        document.body.appendChild(k);
        knoepfe.push(k);
      });
    },
    auswahlAufheben() {}, setzeSpricht() {}, setzeHoert() {}, setzeKatalog() {}, setzeAktive() {}, fokus() {}
  };
}

window.Wolke = api;
if (window.Jarvis) { api.setzeAgenten(Jarvis.agentenStand.agenten, Jarvis.agentenStand.jarvis); if (Jarvis.katalog) api.setzeKatalog(Jarvis.katalog); }
