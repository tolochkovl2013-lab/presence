/**
 * Presence — desktop overlay window.
 *
 * A real always-on-top, click-through-capable, frameless window that hosts
 * the VRM avatar. On Windows it is created with PowerShell + WinForms/WebView2
 * style native window (a borderless topmost form that loads the local page),
 * which is enough to sit above every other window and be dragged around.
 *
 * If the native shell cannot start, we fall back to launching the user's
 * default browser as an app window (Edge/Chrome --app), which is still
 * topmost-friendly and works everywhere.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

function run(cmd, args = [], opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err ? err.message : '')) }));
  });
}

function psFile(script, timeout = 20000) {
  const file = path.join(os.tmpdir(), `presence-win-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(file, script, 'utf8');
  return run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { timeout })
    .finally(() => setTimeout(() => fs.unlink(file, () => {}), 1500));
}

/* ------------------------------------------------------------------ */
/* Native always-on-top window (Windows)                               */
/* ------------------------------------------------------------------ */
function nativeWindowScript(url, { w = 360, h = 520, x = 60, y = 60 } = {}) {
  // A borderless, topmost, transparent-ish WebBrowser host.
  // We use WinForms WebBrowser (IE engine) only as a last resort; the real
  // target is a WebView2 window, which modern Windows 11 has preinstalled.
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(${x}, ${y})
$form.Size = New-Object System.Drawing.Size(${w}, ${h})
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(0,0,0)
$form.TransparencyKey = [System.Drawing.Color]::FromArgb(0,0,0)

# drag with left mouse
$script:drag = $false
$script:last = $null
$form.Add_MouseDown({ param($s,$e) $script:drag = $true; $script:last = [System.Windows.Forms.Cursor]::Position })
$form.Add_MouseUp({ param($s,$e) $script:drag = $false })
$form.Add_MouseMove({
  param($s,$e)
  if ($script:drag -and $script:last) {
    $p = [System.Windows.Forms.Cursor]::Position
    $form.Location = New-Object System.Drawing.Point(($form.Location.X + ($p.X - $script:last.X)), ($form.Location.Y + ($p.Y - $script:last.Y)))
    $script:last = $p
  }
})

$wv = New-Object System.Windows.Forms.WebBrowser
$wv.Dock = 'Fill'
$wv.ScriptErrorsSuppressed = $true
$wv.ScrollBarsEnabled = $false
$wv.IsWebBrowserContextMenuEnabled = $false
$wv.Navigate('${url}')
$form.Controls.Add($wv)

$form.Add_Shown({ $form.Activate() })
[System.Windows.Forms.Application]::Run($form)
`;
}

/* ------------------------------------------------------------------ */
/* Browser app window (fallback, cross-platform)                       */
/* ------------------------------------------------------------------ */
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function browserWindow(url, { w = 360, h = 520, x = 60, y = 60 } = {}) {
  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) return null;
  const args = [
    `--app=${url}`,
    `--window-size=${w},${h}`,
    `--window-position=${x},${y}`,
    '--user-data-dir=' + path.join(os.tmpdir(), 'presence-pet-profile'),
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate',
    '--autoplay-policy=no-user-gesture-required',
  ];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { pid: child.pid, exe };
}

/* ------------------------------------------------------------------ */
/* Window snapping: find the nearest window edge to sit the pet on     */
/* ------------------------------------------------------------------ */
async function windowEdges() {
  if (!IS_WIN) return [];
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$out = @()
$cb = [W+EnumWindowsProc]{
  param($h, $l)
  if ([W]::IsWindowVisible($h)) {
    $len = [W]::GetWindowTextLength($h)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [void][W]::GetWindowText($h, $sb, $sb.Capacity)
      $r = New-Object W+RECT
      if ([W]::GetWindowRect($h, [ref]$r)) {
        $wd = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
        if ($wd -gt 200 -and $ht -gt 120 -and $sb.ToString() -ne 'Presence Avatar') {
          $script:out += [pscustomobject]@{ title = $sb.ToString(); left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom; w = $wd; h = $ht }
        }
      }
    }
  }
  return $true
}
[void][W]::EnumWindows($cb, [IntPtr]::Zero)
$out | ConvertTo-Json -Compress -Depth 3
`;
  const r = await psFile(script, 15000);
  if (!r.ok || !r.out.trim()) return [];
  try {
    const j = JSON.parse(r.out);
    return Array.isArray(j) ? j : [j];
  } catch { return []; }
}

/* snap the pet to the closest free edge of the foreground window */
async function snapTarget(petW = 360, petH = 520) {
  const edges = await windowEdges();
  if (!edges.length) return null;
  // pick the largest window (usually the app being used)
  const target = edges.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
  const rightX = target.right - Math.round(petW * 0.42);
  const bottomY = target.bottom - petH + 8;
  return {
    x: Math.max(-40, Math.min(rightX, (target.right + 40))),
    y: Math.max(0, bottomY),
    window: target.title,
  };
}

module.exports = { nativeWindowScript, browserWindow, windowEdges, snapTarget, psFile, run };
