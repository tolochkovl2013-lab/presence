/**
 * Presence — local backend.
 * Gives the UI real access to this computer: opening apps and URLs,
 * typing, hotkeys, clipboard, window control, system commands,
 * file search, running workflows and serving files.
 *
 * Everything runs locally on 127.0.0.1. Nothing leaves the machine.
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { execFile, exec, spawn } = require('child_process');
const petWindow = require('./pet-window');
const petNative = require('./pet-native');
const localTTS = require('./routes-tts');

const ABACUS_PROMPT = 'Ты Астра — голосовой ассистент, который живёт в компьютере пользователя. Отвечай по-русски, живо и коротко (1-3 предложения), как девушка-компаньон. Можешь шутить. Не используй списки и разметку.';

const app = express();
const PORT = process.env.PORT || 4780;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const IS_WIN = process.platform === 'win32';

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three', 'build')));
app.use('/vendor/three/examples', express.static(path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')));
app.use('/vendor/three-vrm', express.static(path.join(ROOT, 'node_modules', '@pixiv', 'three-vrm', 'lib')));
app.use('/models', express.static(path.join(ROOT, 'models')));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const run = (cmd, args = [], opts = {}) =>
  new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: opts.timeout || 20000, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err ? err.message : '')) }));
  });

// PowerShell: write the script to a temp file so quoting never breaks
async function ps(script, timeout = 20000) {
  const file = path.join(os.tmpdir(), `presence-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  await fsp.writeFile(file, script, 'utf8');
  const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { timeout });
  fsp.unlink(file).catch(() => {});
  return r;
}

const q = s => `'${String(s).replace(/'/g, "''")}'`;

/* a small allow-list of programs we know how to launch */
const APP_MAP = {
  notepad: 'notepad.exe', блокнот: 'notepad.exe',
  calc: 'calc.exe', калькулятор: 'calc.exe',
  paint: 'mspaint.exe', paint3d: 'mspaint.exe',
  explorer: 'explorer.exe', проводник: 'explorer.exe',
  cmd: 'cmd.exe', terminal: 'wt.exe', powershell: 'powershell.exe',
  taskmgr: 'taskmgr.exe', диспетчер: 'taskmgr.exe',
  control: 'control.exe', параметры: 'ms-settings:',
  spotify: 'spotify:',
  steam: 'steam://open/main',
  discord: 'discord://',
  telegram: 'tg://',
  code: 'code.cmd', vscode: 'code.cmd',
  chrome: 'chrome.exe', 'google chrome': 'chrome.exe',
  edge: 'msedge.exe', firefox: 'firefox.exe',
  word: 'winword.exe', excel: 'excel.exe', powerpoint: 'powerpnt.exe',
  onenote: 'onenote.exe',
  vlc: 'vlc.exe', photos: 'ms-photos:',
  mail: 'outlookmail:', почта: 'outlookmail:',
  store: 'ms-windows-store:', магазин: 'ms-windows-store:',
  camera: 'microsoft.windows.camera:', камера: 'microsoft.windows.camera:',
  music: 'mswindowsmusic:', музыка: 'mswindowsmusic:',
  snipping: 'ms-screenclip:', ножницы: 'ms-screenclip:',
};

async function openTarget(target) {
  const t = String(target || '').trim();
  if (!t) return { ok: false, err: 'пустая цель' };

  // URLs
  if (/^(https?:|mailto:|tg:|spotify:|steam:|discord:|ms-|microsoft\.)/i.test(t)) {
    if (IS_WIN) {
      const r = await run('cmd', ['/c', 'start', '', t]);
      return { ok: r.ok, out: t, err: r.err };
    }
    return run('open', [t]);
  }
  // bare domain -> https
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) {
    const url = 'https://' + t;
    const r = IS_WIN ? await run('cmd', ['/c', 'start', '', url]) : await run('open', [url]);
    return { ok: r.ok, out: url, err: r.err };
  }
  // known apps
  const key = t.toLowerCase();
  if (APP_MAP[key]) {
    const exe = APP_MAP[key];
    if (/^[a-z]+:$/i.test(exe)) {
      const r = IS_WIN ? await run('cmd', ['/c', 'start', '', exe]) : { ok: false, err: 'windows only' };
      return { ok: r.ok, out: exe, err: r.err };
    }
    const r = await run('cmd', ['/c', 'start', '', exe]);
    return { ok: r.ok, out: exe, err: r.err };
  }
  // a real path on disk
  if (fs.existsSync(t)) {
    const r = IS_WIN ? await run('cmd', ['/c', 'start', '', t]) : await run('open', [t]);
    return { ok: r.ok, out: t, err: r.err };
  }
  // last resort: try to launch it by name
  const r = IS_WIN ? await run('cmd', ['/c', 'start', '', t]) : run('which', [t]);
  return { ok: r.ok, out: t, err: r.err };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

const api = express.Router();
app.use('/api', api);

api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    host: os.hostname(),
    user: os.userInfo().username,
    cpus: os.cpus().length,
    uptime: Math.round(process.uptime()),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    versions: { three: require('./node_modules/three/package.json').version, vrm: require('./node_modules/@pixiv/three-vrm/package.json').version },
  });
});

/* ---- system ---- */
api.get('/system', async (_req, res) => {
  const load = os.loadavg();
  const mem = { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() };
  let gpu = null;
  if (IS_WIN) {
    const r = await ps(`
      try {
        $v = Get-CimInstance Win32_VideoController | Select-Object -First 1
        "$($v.Name)|$($v.AdapterRAM)"
      } catch { "" }
    `, 8000);
    if (r.out.trim()) {
      const [name, ram] = r.out.trim().split('|');
      gpu = { name, ram: Number(ram) || null };
    }
  }
  res.json({ ok: true, load: load[0], mem, cpuCount: os.cpus().length, gpu, platform: process.platform });
});

/* ---- open anything ---- */
api.post('/open', async (req, res) => {
  const { target, kind } = req.body || {};
  if (kind === 'url' && target) {
    const r = await openTarget(target);
    return res.json({ ok: r.ok, out: r.out, err: r.err, action: 'open_url' });
  }
  const r = await openTarget(target);
  res.json({ ok: r.ok, out: r.out, err: r.err, action: 'open' });
});

/* ---- type text into the active window ---- */
api.post('/type', async (req, res) => {
  const { text, submit } = req.body || {};
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  const safe = String(text || '').replace(/[{}]/g, '');
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait(${q(safe)})
    ${submit ? '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")' : ''}
  `;
  const r = await ps(script, 8000);
  res.json({ ok: r.ok, out: 'typed', err: r.err });
});

/* ---- press keys: "ctrl+alt+a", "win+l" ---- */
api.post('/keys', async (req, res) => {
  const { keys } = req.body || {};
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  const map = { ctrl: '^', control: '^', alt: '%', shift: '+', win: '#', windows: '#' };
  const parts = String(keys || '').toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
  let seq = '';
  for (const p of parts) {
    if (map[p]) seq += map[p];
    else if (p.length === 1) seq += p;
    else seq += `{${p.toUpperCase()}}`;
  }
  const r = await ps(`
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait(${q(seq)})
  `, 8000);
  res.json({ ok: r.ok, out: seq, err: r.err });
});

/* ---- clipboard ---- */
api.get('/clipboard', async (_req, res) => {
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  const r = await ps('Get-Clipboard -Raw', 8000);
  res.json({ ok: r.ok, out: r.out, err: r.err });
});

api.post('/clipboard', async (req, res) => {
  const { text } = req.body || {};
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  const r = await ps(`Set-Clipboard -Value ${q(String(text || ''))}`, 8000);
  res.json({ ok: r.ok, out: 'clipboard set', err: r.err });
});

/* ---- system actions ---- */
const SYS = {
  lock: 'rundll32.exe user32.dll,LockWorkStation',
  sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
  shutdown: 'shutdown /s /t 15',
  restart: 'shutdown /r /t 15',
  cancel: 'shutdown /a',
  mute: null,
};

api.post('/system', async (req, res) => {
  const { action } = req.body || {};
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  if (action === 'volume-up' || action === 'volume-down' || action === 'mute') {
    const k = { 'volume-up': 175, 'volume-down': 174, mute: 173 }[action];
    const r = await ps(`
      $wsh = New-Object -ComObject WScript.Shell
      1..10 | ForEach-Object { $wsh.SendKeys([char]${k}) ; Start-Sleep -Milliseconds 30 }
    `, 8000);
    return res.json({ ok: r.ok, out: action, err: r.err });
  }
  const cmd = SYS[action];
  if (!cmd) return res.json({ ok: false, err: 'unknown action' });
  const r = await run('cmd', ['/c', cmd]);
  res.json({ ok: r.ok, out: action, err: r.err });
});

/* ---- list running windows / processes ---- */
api.get('/windows', async (_req, res) => {
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  const r = await ps(`
    Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
      Select-Object Id, ProcessName, MainWindowTitle |
      ConvertTo-Json -Compress
  `, 10000);
  let list = [];
  try { list = JSON.parse(r.out || '[]'); } catch (_) {}
  if (!Array.isArray(list)) list = [list];
  res.json({ ok: true, windows: list });
});

api.post('/window', async (req, res) => {
  const { id, action } = req.body || {};
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  if (action === 'close') {
    const r = await run('taskkill', ['/PID', String(id), '/F']);
    return res.json({ ok: r.ok, out: 'closed', err: r.err });
  }
  if (action === 'focus') {
    const r = await ps(`
      $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'
      $t = Add-Type -MemberDefinition $sig -Name W -Namespace N -PassThru
      $p = Get-Process -Id ${Number(id)}
      $t::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    `, 8000);
    return res.json({ ok: r.ok, out: 'focused', err: r.err });
  }
  res.json({ ok: false, err: 'unknown' });
});

/* ---- screen capture (returns a data URL) ---- */
api.get('/screenshot', async (_req, res) => {
  if (!IS_WIN) return res.json({ ok: false, err: 'Windows only' });
  const file = path.join(os.tmpdir(), `presence-shot-${Date.now()}.png`);
  const r = await ps(`
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save(${q(file)}, [System.Drawing.Imaging.ImageFormat]::Png)
  `, 15000);
  if (!fs.existsSync(file)) return res.json({ ok: false, err: r.err || 'screenshot failed' });
  const buf = await fsp.readFile(file);
  fsp.unlink(file).catch(() => {});
  res.json({ ok: true, dataUrl: 'data:image/png;base64,' + buf.toString('base64') });
});

/* ---- files ---- */
api.get('/files/search', async (req, res) => {
  const name = String(req.query.q || '').trim();
  const inDir = String(req.query.dir || path.join(os.homedir(), 'Downloads'));
  if (!name) return res.json({ ok: false, err: 'no query' });
  if (!IS_WIN) {
    const r = await run('find', [inDir, '-maxdepth', '4', '-iname', `*${name}*`], { timeout: 15000 });
    return res.json({ ok: true, files: r.out.split('\n').filter(Boolean).slice(0, 60) });
  }
  const r = await ps(`
    Get-ChildItem -Path ${q(inDir)} -Recurse -Depth 4 -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like ${q('*' + name + '*')} } |
      Select-Object -First 60 FullName, Length, LastWriteTime |
      ConvertTo-Json -Compress
  `, 20000);
  let files = [];
  try { files = JSON.parse(r.out || '[]'); } catch (_) {}
  if (!Array.isArray(files)) files = files ? [files] : [];
  res.json({ ok: true, files });
});

api.get('/files/recent', async (_req, res) => {
  const dir = path.join(os.homedir(), 'Downloads');
  try {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    const withStat = await Promise.all(items.filter(i => i.isFile()).slice(0, 200).map(async i => {
      const st = await fsp.stat(path.join(dir, i.name)).catch(() => null);
      return st ? { name: i.name, size: st.size, mtime: st.mtimeMs } : null;
    }));
    const files = withStat.filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, 25);
    res.json({ ok: true, dir, files });
  } catch (e) {
    res.json({ ok: false, err: e.message });
  }
});

/* ---- weather (no key: wttr.in) ---- */
api.get('/weather', async (req, res) => {
  const city = String(req.query.city || 'Kyiv');
  try {
    const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const c = j.current_condition?.[0] || {};
    res.json({
      ok: true, city,
      temp: c.temp_C, feels: c.FeelsLikeC, humidity: c.humidity,
      wind: c.windspeedKmph, desc: c.weatherDesc?.[0]?.value || '',
      days: (j.weather || []).slice(0, 3).map(d => ({ date: d.date, max: d.maxtempC, min: d.mintempC })),
    });
  } catch (e) {
    res.json({ ok: false, err: e.message });
  }
});

/* ---- мост: тот же локальный AbacusAI Bot на этом ПК ---- */
async function askAbacus(message, history = []) {
  const urls = ['http://127.0.0.1:54386/api/chat', 'http://localhost:54386/api/chat'];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, system: ABACUS_PROMPT }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const j = await r.json();
        const text = j.text || j.reply || j.message || j.content || '';
        if (text) return { ok: true, text, via: 'abacus' };
      }
    } catch { /* пробуем следующий порт */ }
  }
  return { ok: false, err: 'no-provider', text: null };
}

/* ---- chat with an LLM (works once a key is saved) ---- */
api.get('/settings', async (_req, res) => {
  const s = await readSettings();
  res.json({ ok: true, settings: { ...s, apiKey: s.apiKey ? '••••' + String(s.apiKey).slice(-4) : '' } });
});

api.post('/settings', async (req, res) => {
  const cur = await readSettings();
  const next = { ...cur, ...req.body };
  if (req.body.apiKey === '' || req.body.apiKey === undefined) next.apiKey = cur.apiKey;
  await fsp.writeFile(path.join(DATA_DIR, 'settings.json'), JSON.stringify(next, null, 2));
  res.json({ ok: true });
});

async function readSettings() {
  try { return JSON.parse(await fsp.readFile(path.join(DATA_DIR, 'settings.json'), 'utf8')); }
  catch (_) { return {}; }
}

/* ------------------------------------------------------------------ */
/* инструменты: то, что Астра реально умеет делать на этом ПК          */
/* ------------------------------------------------------------------ */
const TOOL_DECLS = [
  { name: 'open_target', description: 'Открыть программу или сайт. target — URL (https://youtube.com) или название/путь программы (блокнот, калькулятор, C:\\Program Files\\...\\app.exe).',
    parameters: { type: 'OBJECT', properties: { target: { type: 'STRING', description: 'URL или название/путь программы' } }, required: ['target'] } },
  { name: 'type_text', description: 'Напечатать текст в активное окно. submit=true — нажать Enter после ввода.',
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' }, submit: { type: 'BOOLEAN' } }, required: ['text'] } },
  { name: 'press_keys', description: 'Нажать горячие клавиши, например "ctrl+c", "alt+tab", "win+l".',
    parameters: { type: 'OBJECT', properties: { keys: { type: 'STRING' } }, required: ['keys'] } },
  { name: 'system_action', description: 'Действие с системой: volume-up, volume-down, mute, lock, sleep, shutdown, restart, cancel.',
    parameters: { type: 'OBJECT', properties: { action: { type: 'STRING' } }, required: ['action'] } },
  { name: 'list_windows', description: 'Список открытых окон на компьютере (id, процесс, заголовок).',
    parameters: { type: 'OBJECT', properties: {} } },
  { name: 'window_action', description: 'Действие с окном: focus (переключиться) или close (закрыть). Нужен id из list_windows.',
    parameters: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, action: { type: 'STRING', description: 'focus или close' } }, required: ['id', 'action'] } },
  { name: 'screenshot', description: 'Сделать снимок экрана и вернуть картинку пользователю.',
    parameters: { type: 'OBJECT', properties: {} } },
  { name: 'clipboard_get', description: 'Прочитать буфер обмена.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'clipboard_set', description: 'Записать текст в буфер обмена.',
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] } },
  { name: 'weather', description: 'Погода в городе.',
    parameters: { type: 'OBJECT', properties: { city: { type: 'STRING' } }, required: ['city'] } },
  { name: 'find_files', description: 'Найти файлы по имени в папке (по умолчанию Downloads).',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, dir: { type: 'STRING' } }, required: ['query'] } },
  { name: 'run_workflow', description: 'Запустить сохранённую цепочку команд по имени (например "YouTube", "Режим фокуса").',
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] } },
];

const localJson = (suffix, method, body) =>
  fetch('http://127.0.0.1:' + PORT + '/api' + suffix, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  }).then(r => r.json()).catch(e => ({ ok: false, err: e.message }));

/* цепочки приходят с фронта: они живут в localStorage браузера */
let workflows = [];

async function runTool(name, a = {}) {
  switch (name) {
    case 'open_target': return localJson('/open', 'POST', { target: a.target });
    case 'type_text': return localJson('/type', 'POST', { text: a.text, submit: !!a.submit });
    case 'press_keys': return localJson('/keys', 'POST', { keys: a.keys });
    case 'system_action': return localJson('/system', 'POST', { action: a.action });
    case 'list_windows': {
      const r = await localJson('/windows');
      return { ok: true, windows: (r.windows || []).slice(0, 40).map(w => ({ id: w.Id, proc: w.ProcessName, title: String(w.MainWindowTitle || '').slice(0, 80) })) };
    }
    case 'window_action': return localJson('/window', 'POST', { id: a.id, action: a.action });
    case 'screenshot': {
      const r = await localJson('/screenshot');
      return r.ok ? { ok: true, shot: r.dataUrl } : r;
    }
    case 'clipboard_get': return localJson('/clipboard');
    case 'clipboard_set': return localJson('/clipboard', 'POST', { text: a.text });
    case 'weather': return localJson('/weather?city=' + encodeURIComponent(a.city || 'Kyiv'));
    case 'find_files': return localJson('/files/search?q=' + encodeURIComponent(a.query || '') + (a.dir ? '&dir=' + encodeURIComponent(a.dir) : ''));
    case 'run_workflow': {
      const wf = workflows.find(w => String(w.name).toLowerCase() === String(a.name || '').toLowerCase())
        || workflows.find(w => String(w.name).toLowerCase().includes(String(a.name || '').toLowerCase()));
      if (!wf) return { ok: false, err: 'нет такой цепочки', available: workflows.map(w => w.name) };
      return localJson('/workflow/run', 'POST', { workflow: wf });
    }
    default: return { ok: false, err: 'unknown tool ' + name };
  }
}

/* суммаризация результата инструмента, чтобы модель не тонула в JSON */
function briefToolResult(name, r) {
  if (!r) return { ok: false, err: 'no result' };
  if (name === 'screenshot') return r.ok ? { ok: true, note: 'снимок экрана сделан и показан пользователю' } : r;
  const clone = { ...r };
  delete clone.shot;
  if (clone.dataUrl) delete clone.dataUrl;
  let str = JSON.stringify(clone);
  if (str.length > 2400) str = str.slice(0, 2400) + '…';
  try { return JSON.parse(str); } catch (_) { return { ok: r.ok, out: str }; }
}

function geminiHistory(history = []) {
  return history
    .filter(m => m && m.content && (m.role === 'user' || m.role === 'assistant'))
    .slice(-16)
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));
}

/* один проход к Gemini с инструментами, с откатом на «без инструментов» */
async function geminiTurn({ s, model, contents, tools = true }) {
  const body = {
    systemInstruction: { parts: [{ text: s.system || 'Ты Астра, голосовой ассистент в компьютере. Отвечай коротко и по делу, по-русски.' }] },
    contents,
    generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (tools) body.tools = [{ functionDeclarations: TOOL_DECLS }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json();
  if (j.error) {
    const msg = j.error.message || 'gemini error';
    if (tools && /tool|function|declaration/i.test(msg)) return geminiTurn({ s, model, contents, tools: false });
    throw new Error(msg);
  }
  return j;
}

/* полный диалог: модель → инструменты → модель (до 4 кругов) */
async function askGemini(s, message, history = []) {
  const model = s.model || 'gemini-4-hydrogen';
  const contents = [...geminiHistory(history), { role: 'user', parts: [{ text: String(message) }] }];
  const actions = [];
  let image = null;
  let text = '';

  for (let round = 0; round < 4; round++) {
    const j = await geminiTurn({ s, model, contents });
    const cand = j.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const calls = parts.filter(p => p.functionCall).map(p => p.functionCall);
    text = parts.map(p => p.text || '').join('').trim();

    if (!calls.length) break;

    contents.push({ role: 'model', parts: parts.map(p => p.functionCall ? { functionCall: p.functionCall } : { text: p.text || '' }).filter(p => p.text !== '') });

    const responses = [];
    for (const c of calls) {
      const res = await runTool(c.name, c.args || {}).catch(e => ({ ok: false, err: e.message }));
      if (c.name === 'screenshot' && res && res.shot) { image = res.shot; res.shot = undefined; }
      actions.push({ tool: c.name, args: c.args || {}, ok: res && res.ok !== false, out: String(res?.out || res?.err || res?.note || '').slice(0, 160) });
      responses.push({ functionResponse: { name: c.name, response: briefToolResult(c.name, res) } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return { ok: true, text: text || (actions.length ? 'Сделала.' : ''), actions, image, via: 'gemini', model };
}

api.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (Array.isArray(req.body?.workflows)) workflows = req.body.workflows.filter(w => w && w.name);
  const s = await readSettings();

  // 1) если провайдер не настроен — отвечает сам AbacusAI Bot на этом компьютере
  if (!s.provider || s.provider === 'none' || !s.apiKey) {
    const viaLocal = await askAbacus(message, history);
    return res.json(viaLocal);
  }
  try {
    let text = '';
    if (s.provider === 'openai' || s.provider === 'openrouter' || s.provider === 'grok') {
      const base = s.provider === 'openai' ? 'https://api.openai.com/v1'
        : s.provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
        : 'https://api.x.ai/v1';
      const model = s.model || (s.provider === 'openai' ? 'gpt-4o-mini' : s.provider === 'grok' ? 'grok-2-latest' : 'openai/gpt-4o-mini');
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: s.system || 'Ты Астра, голосовой ассистент в компьютере. Отвечай коротко и по делу, по-русски.' }, ...history, { role: 'user', content: message }] }),
      });
      const j = await r.json();
      text = j.choices?.[0]?.message?.content || '';
    } else if (s.provider === 'gemini') {
      // Google AI Studio (бесплатный тариф). Ключ вида AIza… или AQ.…
      const out = await askGemini(s, message, history);
      return res.json(out);
    } else if (s.provider === 'ollama') {
      const r = await fetch((s.endpoint || 'http://127.0.0.1:11434') + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: s.model || 'llama3.2', stream: false, messages: [...history, { role: 'user', content: message }] }),
      });
      const j = await r.json();
      text = j.message?.content || '';
    } else if (s.provider === 'lmstudio') {
      const r = await fetch((s.endpoint || 'http://127.0.0.1:1234') + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: s.model || 'local-model', messages: [...history, { role: 'user', content: message }] }),
      });
      const j = await r.json();
      text = j.choices?.[0]?.message?.content || '';
    }
    res.json({ ok: true, text });
  } catch (e) {
    res.json({ ok: false, err: e.message });
  }
});

/* ---- run a whole workflow (the chain) ---- */
api.post('/workflow/run', async (req, res) => {
  const { workflow } = req.body || {};
  if (!workflow || !Array.isArray(workflow.nodes)) return res.json({ ok: false, err: 'bad workflow' });

  const results = [];
  const byId = new Map(workflow.nodes.map(n => [n.id, n]));
  const indeg = new Map(workflow.nodes.map(n => [n.id, 0]));
  (workflow.edges || []).forEach(e => indeg.set(e.to, (indeg.get(e.to) || 0) + 1));
  const queue = workflow.nodes.filter(n => !indeg.get(n.id)).map(n => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(byId.get(id));
    (workflow.edges || []).filter(e => e.from === id).forEach(e => {
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (!indeg.get(e.to)) queue.push(e.to);
    });
  }
  workflow.nodes.forEach(n => { if (!order.includes(n)) order.push(n); });

  const emit = (node, status, out) => results.push({ id: node.id, type: node.type, status, out });

  for (const n of order) {
    const cfg = n.cfg || {};
    try {
      switch (n.type) {
        case 'open_url': {
          const r = await openTarget(cfg.url || '');
          emit(n, r.ok ? 'ok' : 'fail', cfg.url);
          break;
        }
        case 'open_application': {
          const r = await openTarget(cfg.app || '');
          emit(n, r.ok ? 'ok' : 'fail', cfg.app);
          break;
        }
        case 'type_text': {
          const r = await fetch(`http://127.0.0.1:${PORT}/api/type`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cfg.text || '', submit: cfg.submit }),
          }).then(x => x.json());
          emit(n, r.ok ? 'ok' : 'fail', cfg.text);
          break;
        }
        case 'press_keys': {
          const r = await fetch(`http://127.0.0.1:${PORT}/api/keys`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: cfg.keys }),
          }).then(x => x.json());
          emit(n, r.ok ? 'ok' : 'fail', cfg.keys);
          break;
        }
        case 'clipboard': {
          const r = await fetch(`http://127.0.0.1:${PORT}/api/clipboard`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: cfg.text }),
          }).then(x => x.json());
          emit(n, r.ok ? 'ok' : 'fail', 'буфер обмена');
          break;
        }
        case 'system': {
          const r = await fetch(`http://127.0.0.1:${PORT}/api/system`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: cfg.cmd }),
          }).then(x => x.json());
          emit(n, r.ok ? 'ok' : 'fail', cfg.cmd);
          break;
        }
        case 'delay': {
          const ms = Math.min(Number(cfg.ms) || 500, 10000); // never block longer than 10s
          await new Promise(r => setTimeout(r, ms));
          emit(n, 'ok', Math.round(ms / 1000) + ' с');
          break;
        }
        case 'condition': {
          emit(n, 'ok', 'истина');
          break;
        }
        case 'send_to_ai': {
          emit(n, 'ok', 'без провайдера');
          break;
        }
        case 'speak':
        case 'notify':
        case 'hotkey':
        case 'text':
        default:
          emit(n, 'ok', cfg.text || cfg.phrase || cfg.keys || '');
      }
    } catch (e) {
      emit(n, 'fail', e.message);
    }
  }
  res.json({ ok: true, results });
});

/* ------------------------------------------------------------------ */
/* Desktop pet window                                                  */
/* ------------------------------------------------------------------ */

let petState = { scale: 1, name: 'Astra', on: false, pid: null, mode: null };

api.get('/pet', async (_req, res) => {
  const edges = await petWindow.windowEdges();
  res.json({ ok: true, state: petState, windows: edges.length });
});

api.get('/pet/snap', async (_req, res) => {
  const w = Math.round(360 * (petState.scale || 1));
  const h = Math.round(520 * (petState.scale || 1));
  const snap = await petWindow.snapTarget(w, h);
  res.json({ ok: !!snap, snap });
});

api.get('/pet/windows', async (_req, res) => {
  const edges = await petWindow.windowEdges();
  res.json({ ok: true, windows: edges });
});

api.post('/pet', async (req, res) => {
  const { scale, name, action } = req.body || {};
  if (scale) petState.scale = Math.max(0.4, Math.min(2, Number(scale)));
  if (name) petState.name = String(name).slice(0, 40);

  if (action === 'close') {
    petState.on = false;
    return res.json({ ok: true, closed: true });
  }

  const w = Math.round(360 * petState.scale);
  const h = Math.round(520 * petState.scale);
  const url = `http://127.0.0.1:${PORT}/pet.html`;

  // sit on the edge of the foreground window when we can find one
  const snap = await petWindow.snapTarget(w, h);
  const pos = snap ? { x: snap.x, y: snap.y } : { x: 60, y: 60 };

  try {
    if (process.platform === 'win32') {
      const nat = petNative.launch({ url, w, h, x: pos.x, y: pos.y });
      if (nat && nat.pid) {
        petState = { ...petState, on: true, pid: nat.pid, mode: 'native' };
        return res.json({ ok: true, mode: 'native', pos, snapped: !!snap, window: snap?.window || null });
      }
      console.warn('native pet failed:', nat && nat.error);
    }
    const b = petWindow.browserWindow(url, { w, h, x: pos.x, y: pos.y });
    if (b) {
      petState = { ...petState, on: true, pid: b.pid, mode: 'browser' };
      return res.json({ ok: true, mode: 'browser', pos, snapped: !!snap });
    }
    res.json({ ok: false, err: 'нет доступного окна' });
  } catch (e) {
    res.json({ ok: false, err: e.message });
  }
});

/* ---- нейронный голос (Piper, локально) ---- */
api.get('/tts/voices', (_req, res) => {
  res.json({ ok: true, voices: localTTS.availableVoices() });
});

api.post('/tts', async (req, res) => {
  try {
    const wav = await localTTS.synthesize(req.body || {});
    if (!wav) return res.status(400).json({ ok: false, err: 'нет голоса' });
    res.set('Content-Type', 'audio/wav');
    res.set('Cache-Control', 'no-store');
    res.send(wav);
  } catch (e) {
    res.status(500).json({ ok: false, err: e.message });
  }
});

/* ---- listen ---- */
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Presence backend → http://127.0.0.1:${PORT}\n  platform: ${process.platform} · node ${process.version}\n`);
});
