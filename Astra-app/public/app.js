/* ============================================================
   Presence — front end
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const api = (p, o) => fetch('/api' + p, o).then(r => r.json());
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================================================
   toasts
   ============================================================ */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' toast--' + kind : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ============================================================
   navigation
   ============================================================ */
const tabs = $$('.tab');
const tabInd = $('#tabInd');
const pages = $$('.page');

function moveInd() {
  const a = $('.tab--active');
  if (!a) return;
  tabInd.style.width = a.offsetWidth + 'px';
  tabInd.style.transform = `translateX(${a.offsetLeft}px)`;
}
function go(tab) {
  tabs.forEach(t => t.classList.toggle('tab--active', t.dataset.tab === tab));
  pages.forEach(p => p.classList.toggle('page--active', p.dataset.page === tab));
  moveInd();
  if (tab === 'commands') requestAnimationFrame(() => { fit(); drawEdges(); });
  if (tab === 'model') requestAnimationFrame(() => resizeVRM());
}
tabs.forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));
window.addEventListener('resize', () => { moveInd(); drawEdges(); resizeVRM(); });

/* ============================================================
   animated Threads background
   ============================================================ */
const bgCanvas = $('#bgCanvas');
const bctx = bgCanvas.getContext('2d');
let bgSpeed = 1, bgAnimate = true, bgRaf = 0, bgT = 0, animColor = '#ffffff';

function hexToRgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h) || [];
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}
function sizeBg() {
  const r = app.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  bgCanvas.width = Math.max(2, Math.round(r.width * dpr));
  bgCanvas.height = Math.max(2, Math.round(r.height * dpr));
  bgCanvas.style.width = r.width + 'px';
  bgCanvas.style.height = r.height + 'px';
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function drawThreads() {
  const r = app.getBoundingClientRect();
  const W = r.width, H = r.height;
  if (!W || !H) return;
  const [cr, cg, cb] = hexToRgb(animColor);
  const t = bgT;
  bctx.clearRect(0, 0, W, H);
  const g = bctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(18,18,22,1)');
  g.addColorStop(.5, 'rgba(10,10,12,1)');
  g.addColorStop(1, 'rgba(22,22,27,1)');
  bctx.fillStyle = g; bctx.fillRect(0, 0, W, H);

  bctx.globalCompositeOperation = 'lighter';
  const N = 24;
  for (let i = 0; i < N; i++) {
    const k = i / N;
    const amp = 40 + Math.sin(i * 1.7) * 30;
    const freq = 0.9 + (i % 5) * 0.22;
    const speed = 0.00022 * (1 + (i % 3) * 0.4);
    const yBase = H * (0.06 + k * 0.92);
    const alpha = 0.05 + 0.07 * Math.abs(Math.sin(i * 0.9 + t * 0.0004));
    bctx.beginPath();
    for (let x = -40; x <= W + 40; x += 12) {
      const p = x / W;
      const y = yBase + Math.sin(p * Math.PI * 2 * freq + t * speed * 60 + i) * amp
        + Math.sin(p * Math.PI * 4 + t * speed * 40 + i * 2) * amp * 0.35;
      x === -40 ? bctx.moveTo(x, y) : bctx.lineTo(x, y);
    }
    bctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
    bctx.lineWidth = 22 + (i % 4) * 14;
    bctx.lineCap = 'round';
    bctx.filter = 'blur(14px)';
    bctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    bctx.beginPath();
    const yB = H * (0.2 + i * 0.2);
    for (let x = -40; x <= W + 40; x += 14) {
      const p = x / W;
      const y = yB + Math.sin(p * 6 + t * 0.0006 + i * 2) * 60 + Math.sin(p * 11 + t * 0.0004) * 18;
      x === -40 ? bctx.moveTo(x, y) : bctx.lineTo(x, y);
    }
    bctx.strokeStyle = `rgba(${cr},${cg},${cb},0.10)`;
    bctx.lineWidth = 2; bctx.filter = 'blur(3px)'; bctx.stroke();
  }
  bctx.filter = 'none';
  bctx.globalCompositeOperation = 'source-over';
}
function loopBg() {
  if (!bgAnimate) return;
  bgT += 16 * bgSpeed;
  drawThreads();
  bgRaf = requestAnimationFrame(loopBg);
}
function restartBg() {
  cancelAnimationFrame(bgRaf);
  sizeBg(); drawThreads();
  if (bgAnimate) loopBg();
}

/* ============================================================
   TTS
   ============================================================ */
const tts = {
  on: true, rate: 1.02, pitch: 1.06, volume: 1,
  splitPhrases: true, breath: true, clean: true, pauseMs: 260,
  voiceURI: '', voices: [], engine: 'system',
};

const pillTTS = $('#pillTTS');
pillTTS.addEventListener('click', () => {
  tts.on = !tts.on;
  pillTTS.classList.toggle('status__pill--on', tts.on);
  if (!tts.on) stopSpeak();
});
$('#ttsBtn')?.addEventListener('click', () => pillTTS.click());

function loadVoices() {
  if (!window.speechSynthesis) return [];
  tts.voices = speechSynthesis.getVoices() || [];
  return tts.voices;
}
function voiceScore(v) {
  let s = 0;
  if (/natural|neural|online/i.test(v.name)) s += 60;
  if (/svetlana|dariya|dmitry|milena|aria|jenny|guy|sonia|ava|emma|liam/i.test(v.name)) s += 40;
  if (/google/i.test(v.name)) s += 25;
  if (v.localService) s += 5;
  if (/^ru/i.test(v.lang)) s += 10;
  return s;
}
function fillVoiceMenu() {
  const menu = $('#voiceMenu'), val = $('#voiceValue');
  if (!menu) return;
  const list = loadVoices();
  menu.innerHTML = '';
  if (!list.length) { val.textContent = 'Голоса не найдены'; return; }
  if (tts.voiceId) { fillNeuralInto(menu); return; }
  const ru = list.filter(v => /^ru/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a));
  const en = list.filter(v => /^en/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a));
  const other = list.filter(v => !/^(ru|en)/i.test(v.lang));
  let first = true;
  [['Русские', ru], ['Английские', en], ['Другие', other]].forEach(([label, arr]) => {
    if (!arr.length) return;
    const h = document.createElement('li');
    h.style.cssText = 'padding:6px 10px;font-size:10px;opacity:.6;pointer-events:none;text-transform:uppercase;letter-spacing:.08em';
    h.textContent = label;
    menu.appendChild(h);
    arr.forEach(v => {
      const li = document.createElement('li');
      li.dataset.uri = v.voiceURI;
      li.textContent = `${v.name} · ${v.lang}`;
      if (first) { li.classList.add('on'); tts.voiceURI = v.voiceURI; val.textContent = v.name; first = false; }
      menu.appendChild(li);
    });
  });
  if (tts.voiceURI) {
    const f = menu.querySelector(`li[data-uri="${CSS.escape(tts.voiceURI)}"]`);
    if (f) {
      menu.querySelectorAll('li.on').forEach(l => l.classList.remove('on'));
      f.classList.add('on');
      const v = tts.voices.find(x => x.voiceURI === tts.voiceURI);
      if (v) val.textContent = v.name;
    }
  }
}
/* нейронные голоса с сервера (Piper) */
let neuralVoices = [];
function fillNeuralInto(menu) {
  if (!neuralVoices.length) return;
  menu.innerHTML = '';
  const h = document.createElement('li');
  h.style.cssText = 'padding:6px 10px;font-size:10px;opacity:.6;pointer-events:none;text-transform:uppercase;letter-spacing:.08em';
  h.textContent = 'Нейронные (локально)';
  menu.appendChild(h);
  neuralVoices.forEach(v => {
    const li = document.createElement('li');
    li.dataset.v = v.id;
    li.textContent = v.name + ' · нейро';
    if (v.id === tts.voiceId) li.classList.add('on');
    menu.appendChild(li);
  });
}
async function loadNeuralVoices() {
  try {
    const j = await api('/tts/voices');
    if (j.ok) {
      neuralVoices = j.voices;
      tts.voiceId = neuralVoices[0]?.id || 'irina';
      renderNeuralMenu();
    }
  } catch { /* нет сервера — остаёмся на браузерных */ }
}
function renderNeuralMenu() {
  const menu = document.querySelector('#voiceMenu'), val = document.querySelector('#voiceValue');
  if (!menu || !neuralVoices.length) return;
  menu.innerHTML = '';
  const h = document.createElement('li');
  h.style.cssText = 'padding:6px 10px;font-size:10px;opacity:.6;pointer-events:none;text-transform:uppercase;letter-spacing:.08em';
  h.textContent = 'Нейронные (локально)';
  menu.appendChild(h);
  neuralVoices.forEach((v, i) => {
    const li = document.createElement('li');
    li.dataset.v = v.id;
    li.textContent = v.name + ' · нейро';
    if (i === 0) li.classList.add('on');
    menu.appendChild(li);
  });
  val.textContent = neuralVoices[0].name + ' · нейро';
}
loadNeuralVoices();

if (window.speechSynthesis) {
  loadVoices();
  speechSynthesis.onvoiceschanged = fillVoiceMenu;
  setTimeout(fillVoiceMenu, 400);
}

function cleanText(s) {
  if (!tts.clean) return s;
  return s.replace(/```[\s\S]*?```/g, ' блок кода ')
    .replace(/[*_`#>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ').trim();
}
function splitPhrases(text) {
  const clean = cleanText(text);
  if (!tts.splitPhrases) return [clean];
  return clean.split(/(?<=[.!?…])\s+/)
    .flatMap(p => (p.length > 190 ? p.split(/(?<=[,;:])\s+/) : [p]))
    .map(p => p.trim()).filter(Boolean);
}
function pickVoice(phrase) {
  const list = tts.voices.length ? tts.voices : loadVoices();
  if (tts.voiceURI) {
    const v = list.find(x => x.voiceURI === tts.voiceURI);
    if (v) return v;
  }
  const ru = /[а-яА-Я]/.test(phrase);
  return list.find(v => (ru ? /^ru/i.test(v.lang) : /^en/i.test(v.lang))) || list[0];
}
function markSpeaking(on) { pillTTS.classList.toggle('status__pill--live', on); }


let ttsAudio = null;
let ttsQueue = [];
let ttsPlaying = false;

async function speak(text) {
  if (!tts.on) return;
  const clean = cleanText(text);
  if (!clean) return;
  ttsQueue.push(clean);
  if (!ttsPlaying) drainTTS();
}

async function drainTTS() {
  ttsPlaying = true;
  markSpeaking(true);
  while (ttsQueue.length) {
    const chunk = ttsQueue.shift();
    const ok = await playNeural(chunk);
    if (!ok) { await speakBrowser(chunk); }
  }
  ttsPlaying = false;
  markSpeaking(false);
}

async function playNeural(text) {
  try {
    const r = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text, voice: tts.voiceId || 'irina', rate: tts.rate, pitch: tts.pitch,
        pauseMs: tts.pauseMs, splitPhrases: tts.splitPhrases, breath: tts.breath,
      }),
    });
    if (!r.ok) return false;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    ttsAudio = new Audio(url);
    ttsAudio.volume = tts.volume;
    ttsAudio.playbackRate = 1; // темп уже учтён в синтезе
    await new Promise(resolve => {
      ttsAudio.onended = resolve;
      ttsAudio.onerror = resolve;
      ttsAudio.play().catch(resolve);
    });
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}

async function speakBrowser(text) {
  if (!window.speechSynthesis) return;
  await new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(text);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = tts.rate; u.pitch = tts.pitch; u.volume = tts.volume;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

function stopSpeak() {
  ttsQueue = [];
  if (ttsAudio) { try { ttsAudio.pause(); } catch {} ttsAudio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  ttsPlaying = false;
  markSpeaking(false);
}

const bindRange = (el, key, out, fmt = v => v) => {
  if (!el) return;
  const upd = () => { tts[key] = parseFloat(el.value); $(out).textContent = fmt(el.value); };
  el.addEventListener('input', upd); upd();
};
bindRange($('#rate'), 'rate', '#rateVal', v => (+v).toFixed(2));
bindRange($('#pitch'), 'pitch', '#pitchVal', v => (+v).toFixed(2));
bindRange($('#volume'), 'volume', '#volumeVal', v => (+v).toFixed(2));
bindRange($('#pauseMs'), 'pauseMs', '#pauseVal', v => Math.round(v));

const bindToggle = (sel, key, obj = tts, cb) => {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('click', () => {
    obj[key] = !obj[key];
    el.classList.toggle('toggle--on', obj[key]);
    cb?.(obj[key]);
  });
  el.classList.toggle('toggle--on', !!obj[key]);
};
bindToggle('#tPause', 'splitPhrases');
bindToggle('#tBreath', 'breath');
bindToggle('#tClean', 'clean');

$('#preview')?.addEventListener('click', () => speak($('#sample').value));
$('#stop')?.addEventListener('click', stopSpeak);
$('#voiceRefresh')?.addEventListener('click', () => { loadVoices(); fillVoiceMenu(); });

/* generic dropdowns */
$$('.select').forEach(sel => {
  const btn = sel.querySelector('.select__value');
  btn?.addEventListener('click', e => {
    e.stopPropagation();
    $$('.select--open').forEach(s => { if (s !== sel) s.classList.remove('select--open'); });
    sel.classList.toggle('select--open');
  });
  sel.querySelectorAll('.select__menu li[data-v], .select__menu li[data-uri]').forEach(li => {
    li.addEventListener('click', () => {
      sel.querySelectorAll('li.on').forEach(l => l.classList.remove('on'));
      li.classList.add('on');
      const label = li.textContent.replace(/\s*·.*$/, '');
      if (btn) btn.innerHTML = label + ' <span>⌄</span>';
      sel.classList.remove('select--open');
      const dv = li.dataset.v || li.dataset.uri || '';
      if (sel.querySelector('#voiceMenu') && dv && !dv.includes(':')) { tts.voiceId = dv; } else if (sel.querySelector('#voiceMenu')) { tts.voiceId = ''; tts.voiceURI = dv; }
      sel.dispatchEvent(new CustomEvent('pick', { detail: dv }));
    });
  });
});
document.addEventListener('click', () => $$('.select--open').forEach(s => s.classList.remove('select--open')));

/* ============================================================
   VRM avatar
   ============================================================ */
const VRM = {
  renderer: null, scene: null, camera: null, current: null,
  clock: new THREE.Clock(), host: null, ready: false, blinkT: 0,
};

function initVRM(host) {
  if (!host || VRM.ready) { VRM.host = host; return; }
  VRM.host = host;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  VRM.renderer = renderer;

  const scene = new THREE.Scene();
  VRM.scene = scene;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.25, 2.4);
  VRM.camera = camera;

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 2, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.1);
  rim.position.set(-2, 1.5, -1.5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffd9c2, 0.8);
  fill.position.set(0, 1, -2);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.minPolarAngle = Math.PI * 0.3;
  controls.maxPolarAngle = Math.PI * 0.62;
  VRM.controls = controls;

  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  VRM.loader = loader;
  VRM.ready = true;
  resizeVRM();
  animateVRM();
}

function resizeVRM() {
  if (!VRM.renderer || !VRM.host) return;
  const r = VRM.host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  VRM.renderer.setSize(r.width, r.height, false);
  VRM.camera.aspect = r.width / r.height;
  VRM.camera.updateProjectionMatrix();
}

function animateVRM() {
  requestAnimationFrame(animateVRM);
  const dt = VRM.clock.getDelta();
  const t = performance.now() / 1000;
  if (VRM.current) {
    const vrm = VRM.current;
    const hm = vrm.humanoid;
    // idle breathing + sway
    const breath = Math.sin(t * 1.6) * 0.012;
    hm?.getNormalizedBoneNode?.('spine')?.rotation.set(Math.sin(t * 1.1) * 0.02, Math.sin(t * 0.7) * 0.04, breath * 0.5);
    hm?.getNormalizedBoneNode?.('chest')?.rotation.set(Math.sin(t * 1.4) * 0.015, 0, 0);
    const head = hm?.getNormalizedBoneNode?.('head');
    if (head) {
      head.rotation.y = Math.sin(t * 0.6) * 0.12;
      head.rotation.x = Math.sin(t * 0.9) * 0.05;
      head.rotation.z = Math.sin(t * 0.5) * 0.03;
    }
    // blink
    VRM.blinkT += dt;
    const blinkPhase = VRM.blinkT % 4.2;
    const blink = blinkPhase > 4.0 ? 1 - Math.abs((blinkPhase - 4.1) / 0.1) : 0;
    vrm.expressionManager?.setValue?.('blink', Math.max(0, Math.min(1, blink)));
    // mouth while speaking
    const speaking = pillTTS.classList.contains('status__pill--live');
    if (vrm.expressionManager) {
      const m = speaking ? 0.35 + Math.abs(Math.sin(t * 14)) * 0.5 : 0;
      vrm.expressionManager.setValue('aa', m);
    }
    vrm.update(dt);
  }
  VRM.controls?.update();
  VRM.renderer?.render(VRM.scene, VRM.camera);
}

function loadVRMUrl(url) {
  if (!VRM.ready) initVRM($('#vrmHost'));
  $('#vrmBadge').textContent = 'VRM: загрузка…';
  VRM.loader.load(url,
    gltf => {
      const vrm = gltf.userData.vrm;
      if (!vrm) { $('#vrmBadge').textContent = 'VRM: не VRM-файл'; return; }
      VRMUtils.rotateVRM0(vrm);
      VRM.scene.add(vrm.scene);
      if (VRM.current) VRM.scene.remove(VRM.current.scene);
      VRM.current = vrm;
      // frame the model
      const box = new THREE.Box3().setFromObject(vrm.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      vrm.scene.position.y -= box.min.y;
      VRM.controls.target.set(0, size.y * 0.55, 0);
      VRM.camera.position.set(0, size.y * 0.62, size.y * 1.25);
      $('#vrmBadge').textContent = 'VRM: ' + (vrm.meta?.name || 'загружено');
      toast('Модель загружена: ' + (vrm.meta?.name || 'VRM'), 'ok');
    },
    xhr => {
      if (xhr.total) $('#vrmBadge').textContent = 'VRM: ' + Math.round(xhr.loaded / xhr.total * 100) + '%';
    },
    err => {
      $('#vrmBadge').textContent = 'VRM: нет файла';
      toast('Не удалось загрузить VRM. Положите .vrm в папку models.', 'fail');
    });
}

/* try a default model, else show a placeholder */
initVRM($('#vrmHost'));
fetch('/models/astra.vrm', { method: 'HEAD' })
  .then(r => { if (r.ok) loadVRMUrl('/models/astra.vrm'); else { $('#vrmBadge').textContent = 'VRM: нет модели — шар-заглушка'; placeholderAvatar(); } })
  .catch(() => { $('#vrmBadge').textContent = 'VRM: нет модели — шар-заглушка'; placeholderAvatar(); });

function placeholderAvatar() {
  if (!VRM.ready || VRM.current) return;
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(.26, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0xbcc2cc, emissive: 0x86b9ec, emissiveIntensity: .75, roughness: .35 })
  );
  orb.position.y = 1.15;
  orb.name = 'orb';
  VRM.scene.add(orb);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(.38, .01, 12, 96),
    new THREE.MeshStandardMaterial({ color: 0xbcc2cc, emissive: 0xb9a2e6, emissiveIntensity: 1.2, transparent: true, opacity: .85 })
  );
  ring.position.y = 1.15;
  ring.rotation.x = Math.PI / 2.4;
  ring.name = 'ring';
  VRM.scene.add(ring);
  VRM.controls.target.set(0, 1.1, 0);
  VRM.camera.position.set(0, 1.25, 1.7);
}

$('#vrmPick')?.addEventListener('click', () => $('#vrmFile').click());
$('#vrmFile')?.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  loadVRMUrl(url);
});
$('#vrmWave')?.addEventListener('click', () => waveArm());
$('#vrmDesktop')?.addEventListener('click', () => {
  toast('Модель уже живёт поверх окон (см. настройки «Модель»)');
  openPetWindow();
});

let waveUntil = 0;
function waveArm() {
  waveUntil = performance.now() + 2200;
  toast('Машет рукой 👋');
}
/* extend animateVRM for waving via a monkey patch on the clock */
setInterval(() => {
  if (!VRM.current || performance.now() > waveUntil) return;
  const arm = VRM.current.humanoid?.getNormalizedBoneNode?.('rightUpperArm');
  if (arm) arm.rotation.z = -1.2 + Math.sin(performance.now() / 90) * 0.25;
}, 40);

/* ============================================================
   Desktop pet (separate always-on-top window)
   ============================================================ */
async function openPetWindow() {
  const scale = parseFloat($('#petScale')?.value || 1);
  const r = await api('/pet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scale }),
  }).catch(() => ({ ok: false }));
  if (r.ok) toast('Модель запущена на рабочем столе', 'ok');
  else toast('Не удалось открыть окно модели', 'fail');
}

/* ============================================================
   chat
   ============================================================ */
const launch = $('#launch'), chat = $('#chat'), msgs = $('#msgs'), chatScroll = $('#chatScroll'), hero = $('#hero');
const input = $('#input'), composer = $('#composer');

function openChat() { launch.hidden = true; chat.hidden = false; setTimeout(() => input.focus(), 60); }
$('#goChat').addEventListener('click', openChat);
$('#goLaunch').addEventListener('click', () => { openChat(); setTimeout(() => handle('Привет'), 250); });

let history = [];

function addMsg(role, text, tool) {
  hero.classList.add('hero--hidden');
  const el = document.createElement('div');
  el.className = 'msg msg--' + role;
  el.innerHTML = `<div class="msg__ava">${role === 'bot' ? 'A' : 'Я'}</div>
    <div class="bubble">${esc(text)}${tool ? `<div class="tool">▸ <b>${esc(tool.n)}</b> ${esc(tool.d || '')}</div>` : ''}</div>`;
  msgs.appendChild(el);
  chatScroll.scrollTop = chatScroll.scrollHeight;
  return el;
}
function say(text, tool) { addMsg('bot', text, tool); speak(text); }

/* ---- intent router: real actions on this PC ---- */
async function handle(text) {
  const low = text.toLowerCase();
  const has = (...w) => w.some(x => low.includes(x));

  // open a site or app
  let m = low.match(/(?:открой|запусти|open|launch)\s+(.+)/);
  if (m) {
    let target = m[1].replace(/^(сайт|приложение|программу|браузер)\s+/, '').trim();
    if (/youtube|ютуб/.test(target)) target = 'https://youtube.com';
    else if (/google|гугл/.test(target)) target = 'https://google.com';
    else if (/telegram|телеграм/.test(target)) target = 'tg://';
    else if (/spotify|спотифай/.test(target)) target = 'spotify:';
    else if (/steam|стим/.test(target)) target = 'steam://open/main';
    else if (/discord|дискорд/.test(target)) target = 'discord://';
    const r = await api('/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
    if (r.ok) return say(`Открыла: ${target}`, { n: 'open', d: target });
    return say(`Не получилось открыть «${target}». ${r.err || ''}`.trim());
  }

  if (has('погод', 'weather')) {
    const w = await api('/weather?city=Kyiv');
    if (w.ok) {
      const t = `Сейчас ${w.temp}°, ${w.desc.toLowerCase()}. Ощущается как ${w.feels}°, ветер ${w.wind} км/ч.`;
      return say(t, { n: 'weather.get', d: w.city });
    }
    return say('Не смогла получить погоду — нет интернета?');
  }

  if (has('окн', 'что открыто', 'процесс', 'программ')) {
    const r = await api('/windows');
    if (r.ok) {
      const list = r.windows.slice(0, 8).map(w => w.MainWindowTitle).filter(Boolean);
      return say(list.length ? 'Открыто: ' + list.join('; ') : 'Окон с заголовками не нашла.', { n: 'windows.list', d: list.length + ' окон' });
    }
    return say('Не удалось получить список окон.');
  }

  if (has('скриншот', 'снимок экрана', 'screenshot')) {
    const r = await api('/screenshot');
    if (r.ok) {
      hero.classList.add('hero--hidden');
      const el = document.createElement('div');
      el.className = 'msg msg--bot';
      el.innerHTML = `<div class="msg__ava">A</div><div class="bubble"><img src="${r.dataUrl}" style="max-width:100%;border-radius:10px;display:block">
        <div class="tool">▸ <b>screenshot</b> экран сохранён</div></div>`;
      msgs.appendChild(el);
      chatScroll.scrollTop = chatScroll.scrollHeight;
      return speak('Сделала снимок экрана.');
    }
    return say('Не удалось сделать скриншот.');
  }

  if (has('заблок', 'lock')) {
    const r = await api('/system', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'lock' }) });
    return say(r.ok ? 'Блокирую компьютер.' : 'Не получилось заблокировать.', { n: 'system.lock', d: '' });
  }
  if (has('громче', 'volume up')) {
    await api('/system', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'volume-up' }) });
    return say('Сделала громче.');
  }
  if (has('тише', 'volume down')) {
    await api('/system', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'volume-down' }) });
    return say('Сделала тише.');
  }
  if (has('без звука', 'mute')) {
    await api('/system', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mute' }) });
    return say('Звук выключен.');
  }

  if (has('буфер', 'clipboard', 'скопировала')) {
    const r = await api('/clipboard');
    return say(r.ok && r.out ? 'В буфере обмена: ' + r.out.slice(0, 400) : 'Буфер обмена пуст.', { n: 'clipboard.get', d: '' });
  }

  if (has('врем', 'котор')) {
    return say('Сейчас ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '.', { n: 'time.now', d: '' });
  }

  if (has('команд', 'цепочк', 'редактор')) {
    go('commands');
    return say('Открываю редактор команд.');
  }

  if (has('привет', 'здравств', 'хай', 'hello', 'hi')) {
    return say('Привет! Ну что, начнём?');
  }

  // fall back to the LLM if configured
  const llm = await api('/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, history }),
  }).catch(() => ({ ok: false }));
  if (llm.ok && llm.text) {
    history.push({ role: 'user', content: text }, { role: 'assistant', content: llm.text });
    return say(llm.text);
  }
  return say('Я умею открывать программы и сайты, показывать погоду, список окон, делать скриншот, управлять звуком и буфером обмена. Подключи провайдера в разделе «ИИ» — и я смогу отвечать на что угодно.');
}

async function send(text) {
  text = (text || '').trim();
  if (!text) return;
  addMsg('user', text);
  input.value = ''; input.style.height = 'auto';
  const typing = document.createElement('div');
  typing.className = 'msg msg--bot';
  typing.innerHTML = '<div class="msg__ava">A</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
  msgs.appendChild(typing);
  chatScroll.scrollTop = chatScroll.scrollHeight;
  const started = Date.now();
  await handle(text);
  typing.remove();
  void started;
}

composer.addEventListener('submit', e => { e.preventDefault(); send(input.value); });
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
$$('#quick button').forEach(b => b.addEventListener('click', () => send(b.dataset.say)));
$('#newChat').addEventListener('click', () => { msgs.innerHTML = ''; hero.classList.remove('hero--hidden'); history = []; input.focus(); });
$('#chipThink').addEventListener('click', e => e.currentTarget.classList.toggle('chip--on'));
$('#chipPro').addEventListener('click', e => e.currentTarget.classList.toggle('chip--on'));
$('#shotBtn')?.addEventListener('click', () => send('Сделай скриншот'));
$('#bell')?.addEventListener('click', () => send('Что у меня открыто?'));

/* ============================================================
   settings page
   ============================================================ */
$$('.select').forEach(sel => sel.addEventListener('pick', e => {
  if (sel.contains($('#bgMenu'))) app.dataset.bg = e.detail;
}));
$('#bgSpeed')?.addEventListener('input', e => { bgSpeed = parseFloat(e.target.value); $('#bgSpeedVal').textContent = e.target.value; });
$('#colAnim')?.addEventListener('input', e => { animColor = e.target.value; drawThreads(); });
$('#colBg')?.addEventListener('input', e => {
  document.documentElement.style.setProperty('--bg-color', e.target.value);
  app.style.background = app.dataset.bg === 'gradient' ? e.target.value : '';
});
let animateInactive = false;
$('#tInactive')?.addEventListener('click', e => {
  animateInactive = !animateInactive;
  e.currentTarget.classList.toggle('toggle--on', animateInactive);
});
$('#tBubbles')?.addEventListener('click', e => {
  const on = !e.currentTarget.classList.contains('toggle--on');
  e.currentTarget.classList.toggle('toggle--on', on);
  app.dataset.bubbles = on ? 'on' : 'off';
});
$$('.toggle:not([id])').forEach(t => t.addEventListener('click', () => t.classList.toggle('toggle--on')));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !animateInactive) cancelAnimationFrame(bgRaf);
  else if (!document.hidden && bgAnimate) loopBg();
});

$('#sysWindows')?.addEventListener('click', () => send('Что у меня открыто?'));
$('#sysShot')?.addEventListener('click', () => send('Сделай скриншот'));
$('#sysWeather')?.addEventListener('click', () => send('Какая погода?'));

/* ============================================================
   AI settings
   ============================================================ */
$('#aiMenu')?.addEventListener('click', async e => {
  const li = e.target.closest('li[data-v]');
  if (!li) return;
  const provider = li.dataset.v;
  await api('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) });
});
$('#aiSave')?.addEventListener('click', async () => {
  const body = {
    apiKey: $('#apiKey').value || undefined,
    model: $('#aiModel').value,
    endpoint: $('#aiEndpoint').value,
  };
  await api('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  toast('Настройки ИИ сохранены', 'ok');
});
$('#aiTest')?.addEventListener('click', async () => {
  const r = await api('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'скажи «ок»' }) });
  if (r.ok && r.text) toast('Провайдер отвечает: ' + r.text.slice(0, 60), 'ok');
  else toast('Провайдер не отвечает: ' + (r.err || 'нет ключа'), 'fail');
});

/* ============================================================
   health / status
   ============================================================ */
(async function boot() {
  sizeBg(); restartBg();
  requestAnimationFrame(() => { moveInd(); fit(); });

  const h = await api('/health').catch(() => null);
  if (h) {
    $('#statusLeft').innerHTML = `Меню <i>·</i> <b>${esc(h.user)}</b>`;
    $('#statusRight').textContent = h.host;
    $('#sysInfo').textContent = `${h.platform} ${h.arch} · node ${h.node} · ${h.cpus} CPU · ${(h.totalmem / 1e9).toFixed(1)} ГБ RAM`;
    $('#runtimeMeta').innerHTML = `<b>node ${h.node}</b> · three ${h.versions.three} · three-vrm ${h.versions.vrm}`;
    $('#launchNote').textContent = `Подключено к ${h.host} · ${h.platform}`;
    $('#pillAI').classList.add('status__pill--on');
  } else {
    $('#launchNote').textContent = 'Бэкенд недоступен — только интерфейс';
  }
  // движок озвучки: по умолчанию нейронный серверный
  const eng = localStorage.getItem('presence.engine');
  if (eng === 'system') { tts.voiceId = ''; }

  const s = await api('/settings').catch(() => null);
  if (s?.settings) {
    if (s.settings.provider) {
      const li = $(`#aiMenu li[data-v="${s.settings.provider}"]`);
      if (li) li.click();
    }
    if (s.settings.model) $('#aiModel').value = s.settings.model;
    if (s.settings.endpoint) $('#aiEndpoint').value = s.settings.endpoint;
    if (s.settings.apiKey) $('#apiKey').placeholder = s.settings.apiKey;
  }
})();

/* ============================================================
   commands — workflow engine (runs on the backend)
   ============================================================ */
const META = {
  hotkey: { kind: 'trigger', ico: '⌨', label: 'Хоткей' },
  text: { kind: 'trigger', ico: '◉', label: 'Голосовая фраза' },
  open_url: { kind: 'action', ico: '🌐', label: 'Открыть URL' },
  open_application: { kind: 'action', ico: '▤', label: 'Открыть приложение' },
  type_text: { kind: 'action', ico: '⌨', label: 'Ввести текст' },
  press_keys: { kind: 'action', ico: '⌨', label: 'Нажать клавиши' },
  speak: { kind: 'action', ico: '▮', label: 'Сказать' },
  notify: { kind: 'action', ico: '◔', label: 'Уведомление' },
  send_to_ai: { kind: 'action', ico: '✦', label: 'Отправить в ИИ' },
  system: { kind: 'action', ico: '⚙', label: 'Система' },
  clipboard: { kind: 'action', ico: '▦', label: 'Буфер обмена' },
  wait: { kind: 'action', ico: '◷', label: 'Подождать' },
  condition: { kind: 'condition', ico: '⑃', label: 'Условие' },
  loop: { kind: 'loop', ico: '↻', label: 'Цикл' },
  switch: { kind: 'switch', ico: '⇄', label: 'Переключатель' },
  delay: { kind: 'delay', ico: '◷', label: 'Задержка' },
};

const WF = JSON.parse(localStorage.getItem('presence.workflows') || 'null') || [
  {
    id: 'yt', name: 'Открыть YouTube и найти', enabled: true,
    nodes: [
      { id: 't1', type: 'hotkey', x: 40, y: 10, cfg: { keys: 'Alt + Y' } },
      { id: 'a1', type: 'open_url', x: 40, y: 118, cfg: { url: 'https://youtube.com' } },
      { id: 'c1', type: 'condition', x: 40, y: 226, cfg: { expr: 'Astra запущена?' } },
      { id: 'a2', type: 'type_text', x: -120, y: 334, cfg: { text: 'lofi hip hop' } },
      { id: 'a3', type: 'notify', x: 190, y: 334, cfg: { text: 'Astra не запущена' } },
    ],
    edges: [{ from: 't1', to: 'a1' }, { from: 'a1', to: 'c1' }, { from: 'c1', to: 'a2', port: 'true' }, { from: 'c1', to: 'a3', port: 'false' }],
  },
  {
    id: 'meet', name: 'Заметки со встречи', enabled: true,
    nodes: [
      { id: 't1', type: 'text', x: 60, y: 10, cfg: { phrase: 'запиши заметки' } },
      { id: 'a1', type: 'open_application', x: 60, y: 118, cfg: { app: 'notepad' } },
      { id: 'a2', type: 'type_text', x: 60, y: 226, cfg: { text: 'Заметки со встречи:' } },
      { id: 'a3', type: 'notify', x: 60, y: 334, cfg: { text: 'Заметки готовы' } },
    ],
    edges: [{ from: 't1', to: 'a1' }, { from: 'a1', to: 'a2' }, { from: 'a2', to: 'a3' }],
  },
  {
    id: 'focus', name: 'Режим фокуса', enabled: true,
    nodes: [
      { id: 't1', type: 'text', x: 60, y: 10, cfg: { phrase: 'режим фокуса' } },
      { id: 'a1', type: 'open_url', x: 60, y: 118, cfg: { url: 'https://youtube.com/results?search_query=lofi+focus' } },
      { id: 'd1', type: 'delay', x: 60, y: 226, cfg: { ms: 3000 } },
      { id: 'a2', type: 'notify', x: 60, y: 334, cfg: { text: 'Фокус-плейлист включён' } },
    ],
    edges: [{ from: 't1', to: 'a1' }, { from: 'a1', to: 'd1' }, { from: 'd1', to: 'a2' }],
  },
  {
    id: 'hello', name: 'Поздороваться', enabled: true,
    nodes: [
      { id: 't1', type: 'text', x: 60, y: 30, cfg: { phrase: 'привет' } },
      { id: 'a1', type: 'speak', x: 60, y: 148, cfg: { text: 'Привет, я тут.' } },
    ],
    edges: [{ from: 't1', to: 'a1' }],
  },
  {
    id: 'lock', name: 'Заблокировать компьютер', enabled: true,
    nodes: [
      { id: 't1', type: 'hotkey', x: 60, y: 30, cfg: { keys: 'Ctrl + Alt + L' } },
      { id: 'a1', type: 'system', x: 60, y: 148, cfg: { cmd: 'lock' } },
    ],
    edges: [{ from: 't1', to: 'a1' }],
  },
];

const cmdList = $('#cmdList'), flow = $('#flow'), edgesSvg = $('#edges'), canvas = $('#canvas');
const wfName = $('#wfName'), wfMeta = $('#wfMeta'), wfZoom = $('#wfZoom'), logRows = $('#logRows');
let cur = WF[0], view = { x: 220, y: 30, k: .95 }, selected = null, linking = false;

const saveWF = () => localStorage.setItem('presence.workflows', JSON.stringify(WF));

function renderList() {
  cmdList.innerHTML = '';
  WF.forEach(w => {
    const li = document.createElement('li');
    li.className = 'cmd-item' + (w.id === cur.id ? ' cmd-item--active' : '') + (w.enabled ? '' : ' cmd-item--off');
    const a = w.nodes.filter(n => META[n.type]?.kind === 'action').length;
    const t = w.nodes.filter(n => META[n.type]?.kind === 'trigger').length;
    li.innerHTML = `<span class="cmd-item__name">${esc(w.name)}</span>
      <span class="cmd-item__meta">${t} триг. / ${a} действ.${w.enabled ? '' : ' · выкл'}</span>`;
    li.addEventListener('click', () => { cur = w; wfName.value = w.name; selected = null; renderList(); renderFlow(); fit(); });
    cmdList.appendChild(li);
  });
}
function nodeSub(n) {
  const c = n.cfg || {};
  return c.url || c.keys || c.phrase || c.text || c.app || c.cmd || c.expr || c.prompt || (c.ms ? Math.round(c.ms / 1000) + ' с' : '');
}
function applyView() {
  const tr = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  flow.style.transform = tr; edgesSvg.style.transform = tr;
  if (wfZoom) wfZoom.textContent = Math.round(view.k * 100) + '%';
}
function renderFlow() {
  flow.innerHTML = '';
  applyView();
  const a = cur.nodes.filter(n => META[n.type]?.kind === 'action').length;
  const t = cur.nodes.filter(n => META[n.type]?.kind === 'trigger').length;
  wfMeta.textContent = `${t} триг. / ${a} действ.`;

  cur.nodes.forEach(n => {
    const m = META[n.type] || { kind: 'action', ico: '•', label: n.type };
    const el = document.createElement('div');
    el.className = `node node--${m.kind}`;
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    el.dataset.id = n.id;
    el.innerHTML = `<span class="node__port node__port--in"></span>
      <div class="node__head"><span class="node__ico">${m.ico}</span><span class="node__title">${esc(m.label)}</span></div>
      <div class="node__sub">${esc(nodeSub(n))}</div>
      <span class="node__port node__port--out"></span>`;
    makeDrag(el, n);
    el.addEventListener('click', e => {
      e.stopPropagation();
      $$('.node--selected').forEach(x => x.classList.remove('node--selected'));
      el.classList.add('node--selected');
      selected = n;
      if (linking) {
        // second click completes the link
        const from = linking;
        linking = false;
        if (from.id !== n.id) {
          cur.edges.push({ from: from.id, to: n.id });
          saveWF(); drawEdges();
        }
        toast('Связь создана', 'ok');
      }
    });
    flow.appendChild(el);
  });
  drawEdges();
}
function box(id) {
  const el = flow.querySelector(`[data-id="${id}"]`);
  return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
}
function drawEdges() {
  edgesSvg.innerHTML = '';
  cur.edges.forEach(e => {
    const a = box(e.from), b = box(e.to);
    if (!a || !b) return;
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
    const dx = Math.max(38, Math.abs(x2 - x1) * .5);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', e.port === 'false' ? '#f2846f88' : e.port === 'true' ? '#a6cf8a88' : '#ffffff40');
    p.setAttribute('stroke-width', '1.6');
    edgesSvg.appendChild(p);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x2); c.setAttribute('cy', y2); c.setAttribute('r', '3');
    c.setAttribute('fill', e.port === 'false' ? '#f2846f' : e.port === 'true' ? '#a6cf8a' : '#bcc2cc');
    edgesSvg.appendChild(c);
  });
}
function makeDrag(el, node) {
  let st = null;
  el.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.node__port')) return;
    ev.stopPropagation();
    el.classList.add('node--drag');
    st = { mx: ev.clientX, my: ev.clientY, nx: node.x, ny: node.y };
    el.setPointerCapture(ev.pointerId);
  });
  el.addEventListener('pointermove', ev => {
    if (!st) return;
    node.x = Math.round(st.nx + (ev.clientX - st.mx) / view.k);
    node.y = Math.round(st.ny + (ev.clientY - st.my) / view.k);
    el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
    drawEdges();
  });
  const end = () => { if (st) { st = null; saveWF(); } el.classList.remove('node--drag'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
let pan = null;
canvas.addEventListener('pointerdown', e => {
  if (e.target.closest('.node')) return;
  pan = { mx: e.clientX, my: e.clientY, x: view.x, y: view.y };
  canvas.classList.add('wf__canvas--panning');
});
window.addEventListener('pointermove', e => {
  if (!pan) return;
  view.x = pan.x + (e.clientX - pan.mx);
  view.y = pan.y + (e.clientY - pan.my);
  applyView();
});
window.addEventListener('pointerup', () => { pan = null; canvas.classList.remove('wf__canvas--panning'); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  view.k = Math.min(1.8, Math.max(.45, view.k * (e.deltaY > 0 ? .92 : 1.08)));
  applyView();
}, { passive: false });

function fit() {
  if (!cur.nodes.length) return;
  const xs = cur.nodes.map(n => n.x), ys = cur.nodes.map(n => n.y);
  view.x = 70 - Math.min(...xs) * .9;
  view.y = 22 - Math.min(...ys) * .9;
  view.k = .9;
  applyView();
}
$('#wfFit').addEventListener('click', fit);
$('#wfLayout').addEventListener('click', () => {
  const seen = new Set(), cols = new Map();
  const q = cur.nodes.filter(n => META[n.type]?.kind === 'trigger').map(n => ({ n, d: 0 }));
  while (q.length) {
    const { n, d } = q.shift();
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const l = cols.get(d) || []; l.push(n); cols.set(d, l);
    cur.edges.filter(e => e.from === n.id).forEach(e => {
      const t = cur.nodes.find(x => x.id === e.to);
      if (t) q.push({ n: t, d: d + 1 });
    });
  }
  cur.nodes.forEach(n => { if (!seen.has(n.id)) { const l = cols.get(99) || []; l.push(n); cols.set(99, l); } });
  [...cols.keys()].sort((a, b) => a - b).forEach((d, ci) => {
    cols.get(d).forEach((n, ri) => { n.x = 60 + ci * 220; n.y = 18 + ri * 112; });
  });
  saveWF(); renderFlow(); fit();
});
$('#wfAdd').addEventListener('click', () => {
  cur.nodes.push({ id: 'n' + Math.random().toString(36).slice(2, 6), type: 'notify', x: 60, y: 20 + cur.nodes.length * 40, cfg: { text: 'Новый шаг' } });
  saveWF(); renderFlow();
});
$('#wfLink').addEventListener('click', () => {
  if (!selected) return toast('Сначала выберите узел-источник', 'fail');
  linking = selected;
  toast('Теперь кликните по узлу-приёмнику');
});
$('#wfDelete').addEventListener('click', () => {
  if (!selected) return toast('Нечего удалять', 'fail');
  cur.nodes = cur.nodes.filter(n => n !== selected);
  cur.edges = cur.edges.filter(e => e.from !== selected.id && e.to !== selected.id);
  selected = null;
  saveWF(); renderFlow();
});
$('#cmdAdd').addEventListener('click', () => {
  const w = { id: 'w' + Date.now(), name: 'Новая команда', enabled: true, nodes: [{ id: 't1', type: 'text', x: 60, y: 20, cfg: { phrase: 'фраза' } }], edges: [] };
  WF.push(w); cur = w; wfName.value = w.name; saveWF(); renderList(); renderFlow(); fit();
});
$('#wfSave').addEventListener('click', () => { cur.name = wfName.value; saveWF(); renderList(); toast('Команда сохранена', 'ok'); });
wfName.addEventListener('input', () => { cur.name = wfName.value; });
$('#logClear').addEventListener('click', () => { logRows.innerHTML = '<li class="empty">Пока ничего не запускали.</li>'; });

async function runWf() {
  logRows.innerHTML = '';
  const r = await api('/workflow/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow: cur }),
  }).catch(() => ({ ok: false }));

  if (!r.ok || !r.results) {
    logRows.innerHTML = '<li class="fail"><b>✕</b> бэкенд недоступен</li>';
    return;
  }
  for (const res of r.results) {
    const m = META[res.type] || { label: res.type };
    const el = flow.querySelector(`[data-id="${res.id}"]`);
    el?.classList.add('node--run');
    await sleep(220);
    el?.classList.remove('node--run');
    el?.classList.add(res.status === 'ok' ? 'node--ok' : 'node--fail');
    setTimeout(() => el?.classList.remove('node--ok', 'node--fail'), 1600);

    const li = document.createElement('li');
    li.className = res.status;
    li.innerHTML = `<b>${res.status === 'ok' ? '✓' : '✕'}</b><span>${esc(m.label)}</span>
      <span style="margin-left:auto;opacity:.7">${esc(res.out || '')}</span>`;
    logRows.appendChild(li);
    logRows.scrollTop = logRows.scrollHeight;
    if (res.type === 'speak') speak(res.out);
  }
  const li = document.createElement('li');
  li.className = 'ok';
  li.innerHTML = `<b>✓</b><span>готово</span><span style="margin-left:auto;opacity:.7">${r.results.length} шагов</span>`;
  logRows.appendChild(li);
}
$('#wfRun').addEventListener('click', runWf);
$('#wfRun2').addEventListener('click', runWf);

renderList(); renderFlow();

/* ============================================================
   model page toggles
   ============================================================ */
bindToggle('#tPetOn', 'on', { on: true }, on => { if (on) openPetWindow(); });
bindToggle('#tPetCursor', 'on', { on: true });
bindToggle('#tPetEdge', 'on', { on: true });
bindToggle('#tPetDance', 'on', { on: false });
$('#petScale')?.addEventListener('input', e => {
  $('#petScaleVal').textContent = (+e.target.value).toFixed(2);
  fetch('/api/pet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scale: +e.target.value }) }).catch(() => {});
});
$('#petName')?.addEventListener('change', e => {
  localStorage.setItem('presence.name', e.target.value);
  fetch('/api/pet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: e.target.value }) }).catch(() => {});
});
$('#petName').value = localStorage.getItem('presence.name') || 'Astra';

/* expose for the pet window */
window.__presence = { speak, toast };
