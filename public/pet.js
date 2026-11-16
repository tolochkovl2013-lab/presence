/* ============================================================
   Desktop pet — the VRM avatar that lives on top of every window
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const err = document.getElementById('err');
const showErr = m => { err.style.display = 'block'; err.textContent = m; };

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
camera.position.set(0, 1.3, 2.6);

scene.add(new THREE.AmbientLight(0xffffff, 1.7));
const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(1.4, 2.2, 2); scene.add(key);
const rim = new THREE.DirectionalLight(0x8fb6ff, 1.2); rim.position.set(-2, 1.4, -1.6); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffd9c2, .9); fill.position.set(0, .8, -2); scene.add(fill);

const clock = new THREE.Clock();
let vrm = null;

const loader = new GLTFLoader();
loader.register(p => new VRMLoaderPlugin(p));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function fitModel(model) {
  const box = new THREE.Box3().setFromObject(model.scene);
  const size = box.getSize(new THREE.Vector3());
  model.scene.position.y -= box.min.y;
  // кадрируем по голове и плечам — как в реальном приложении
  const h = size.y;
  camera.fov = 26;
  const targetY = h * 0.78;
  camera.position.set(0, targetY + h * 0.02, h * 0.42);
  camera.lookAt(0, targetY, 0);
  camera.updateProjectionMatrix();
}

function placeholder() {
  err.style.display = 'none';
  // светящийся шар-заглушка, чтобы окно никогда не было пустым
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(.32, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0xbcc2cc, emissive: 0x86b9ec, emissiveIntensity: .7, roughness: .35 })
  );
  orb.position.y = 1.2;
  orb.name = 'orb';
  scene.add(orb);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(.46, .012, 12, 96),
    new THREE.MeshStandardMaterial({ color: 0xbcc2cc, emissive: 0xb9a2e6, emissiveIntensity: 1.2, transparent: true, opacity: .8 })
  );
  ring.position.y = 1.2;
  ring.rotation.x = Math.PI / 2.4;
  ring.name = 'ring';
  scene.add(ring);
}

// сначала пробуем модель, если её нет — шар
fetch('/models/astra.vrm', { method: 'HEAD' }).then(r => {
  if (!r.ok) { placeholder(); return; }
  loader.load('/models/astra.vrm',
    gltf => {
      const v = gltf.userData.vrm;
      if (!v) { showErr('Файл не является VRM'); placeholder(); return; }
      VRMUtils.rotateVRM0(v);
      scene.add(v.scene);
      fitModel(v);
      vrm = v;
    },
    null,
    () => { placeholder(); });
}).catch(() => placeholder());

let t0 = performance.now();
let waveUntil = 0;
let blinkT = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = performance.now() / 1000;

  if (vrm) {
    const hm = vrm.humanoid;
    hm?.getNormalizedBoneNode?.('spine')?.rotation.set(Math.sin(t * 1.1) * .02, Math.sin(t * .7) * .04, Math.sin(t * 1.6) * .006);
    hm?.getNormalizedBoneNode?.('chest')?.rotation.set(Math.sin(t * 1.4) * .015, 0, 0);
    const head = hm?.getNormalizedBoneNode?.('head');
    if (head) {
      head.rotation.y = Math.sin(t * .6) * .12;
      head.rotation.x = Math.sin(t * .9) * .05;
    }
    if (performance.now() < waveUntil) {
      const arm = hm?.getNormalizedBoneNode?.('rightUpperArm');
      if (arm) arm.rotation.z = -1.2 + Math.sin(performance.now() / 90) * .25;
    }
    blinkT += dt;
    const ph = blinkT % 4.2;
    const blink = ph > 4.0 ? 1 - Math.abs((ph - 4.1) / .1) : 0;
    vrm.expressionManager?.setValue?.('blink', Math.max(0, Math.min(1, blink)));
    vrm.update(dt);
  } else {
    // пульсация заглушки
    const orb = scene.getObjectByName('orb');
    const ring = scene.getObjectByName('ring');
    if (orb) {
      orb.position.y = 1.2 + Math.sin(t * 1.5) * .04;
      orb.rotation.y += dt * .3;
      const s = 1 + Math.sin(t * 2.2) * .03;
      orb.scale.setScalar(s);
    }
    if (ring) {
      ring.rotation.z += dt * .6;
      ring.rotation.x = Math.PI / 2.4 + Math.sin(t * .8) * .15;
    }
  }
  renderer.render(scene, camera);
}
animate();

/* ---- window dragging through the Electron-less bridge ---- */
let drag = null;
window.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  drag = { x: e.screenX, y: e.screenY };
  // ask the shell (if any) to start dragging
  window.parent?.postMessage?.({ type: 'pet-drag-start' }, '*');
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  window.parent?.postMessage?.({ type: 'pet-drag-move', dx: e.screenX - drag.x, dy: e.screenY - drag.y }, '*');
});
window.addEventListener('mouseup', () => { drag = null; window.parent?.postMessage?.({ type: 'pet-drag-end' }, '*'); });

window.addEventListener('dblclick', () => {
  waveUntil = performance.now() + 2000;
  window.parent?.postMessage?.({ type: 'pet-click' }, '*');
});

/* мини-панель управления аватаром */
document.getElementById('wave')?.addEventListener('click', () => { waveUntil = performance.now() + 2200; });
document.getElementById('hide')?.addEventListener('click', () => {
  fetch('/api/pet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close' }) });
  window.close();
});
document.getElementById('talk')?.addEventListener('click', async () => {
  const r = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Скажи что-нибудь короткое и дружелюбное по-русски.' }),
  }).then(x => x.json()).catch(() => ({ ok: false }));
  const text = r.ok && r.text ? r.text : 'Я тут. Скажи, что нужно сделать.';
  if (window.speechSynthesis) {
    const list = speechSynthesis.getVoices();
    const v = list.find(x => /^ru/i.test(x.lang) && /natural|neural|svetlana|dariya|dmitry/i.test(x.name))
      || list.find(x => /^ru/i.test(x.lang));
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#]/g, ''));
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1.02; u.pitch = 1.06;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
});

/* receive speech from the main window */
window.addEventListener('message', ev => {
  const d = ev.data || {};
  if (d.type === 'pet-speak' && window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(d.text);
    u.lang = 'ru-RU'; u.rate = 1.02; u.pitch = 1.06;
    speechSynthesis.speak(u);
  }
  if (d.type === 'pet-wave') waveUntil = performance.now() + 2000;
});
