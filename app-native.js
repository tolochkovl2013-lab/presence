/**
 * Astra.exe — сборка настоящего приложения (не сайта).
 *
 * C# WinForms-оболочка:
 *   • хостит интерфейс в WebView2 (полноценный браузер, не IE)
 *   • иконка, трей, своё окно без адресной строки
 *   • сама поднимает node-бэкенд, если он не запущен
 *   • кнопка «аватар на рабочий стол»
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const WORK = path.join(ROOT, 'data', 'app-build');
const WV2 = path.join(ROOT, 'vendor', 'wv2');

const CSHARP = String.raw`
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

public class App : Form
{
    private WebView2 web;
    private NotifyIcon tray;
    private const string BASE = "http://127.0.0.1:4780/";
    private bool quitting = false;

    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);

    public App()
    {
        Text = "Astra";
        Size = new Size(1240, 820);
        MinimumSize = new Size(900, 620);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(11, 11, 13);
        try { Icon = new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "astra.ico")); }
        catch { }

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.FromArgb(11, 11, 13);
        Controls.Add(web);

        web.CoreWebView2InitializationCompleted += (s, e) =>
        {
            if (!e.IsSuccess) { MessageBox.Show("WebView2 не запустился: " + e.InitializationException); return; }
            var st = web.CoreWebView2.Settings;
            st.AreDefaultContextMenusEnabled = false;
            st.IsStatusBarEnabled = false;
            st.IsZoomControlEnabled = false;
            st.AreDevToolsEnabled = true;
            web.CoreWebView2.WebMessageReceived += (s2, e2) => { };
            web.CoreWebView2.Navigate(BASE);
        };

        Shown += async (s, e) =>
        {
            MakeTray();
            try
            {
                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Astra", "webview2");
                var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex) { MessageBox.Show("Ошибка WebView2: " + ex.Message); }
        };

        FormClosing += (s, e) =>
        {
            if (!quitting && tray != null)
            {
                e.Cancel = true;
                Hide();
                tray.ShowBalloonTip(1200, "Astra", "Работаю в фоне — иконка в трее.", ToolTipIcon.Info);
            }
        };
    }

    private void MakeTray()
    {
        tray = new NotifyIcon();
        try { tray.Icon = new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "astra.ico")); }
        catch { tray.Icon = SystemIcons.Application; }
        tray.Text = "Astra";
        tray.Visible = true;

        var menu = new ContextMenuStrip();
        menu.Items.Add("Открыть", null, (s, e) => { Show(); WindowState = FormWindowState.Normal; Activate(); });
        menu.Items.Add("Аватар на рабочий стол", null, (s, e) => LaunchAvatar());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Выход", null, (s, e) => { quitting = true; tray.Visible = false; Application.Exit(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (s, e) => { Show(); Activate(); };
    }

    private void LaunchAvatar()
    {
        try
        {
            var cl = new WebClient();
            cl.Headers.Add("Content-Type", "application/json");
            cl.UploadString(BASE + "api/pet", "POST", "{\"scale\":1}");
        }
        catch { }
    }

    [STAThread]
    public static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool single = true;
        var mutex = new Mutex(true, "AstraPresenceSingleInstance", out single);
        if (!single) { return; }
        Application.Run(new App());
    }
}
`;

function copyDlls() {
  fs.mkdirSync(WORK, { recursive: true });
  const files = [
    [path.join(WV2, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll'), 'Microsoft.Web.WebView2.Core.dll'],
    [path.join(WV2, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll'), 'Microsoft.Web.WebView2.WinForms.dll'],
    [path.join(WV2, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'), 'WebView2Loader.dll'],
    [path.join(ROOT, 'brand', 'astra.ico'), 'astra.ico'],
  ];
  for (const [src, name] of files) {
    const dst = path.join(WORK, name);
    if (!fs.existsSync(src)) return `нет ${src}`;
    if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) fs.copyFileSync(src, dst);
  }
  return null;
}

function build() {
  const err = copyDlls();
  if (err) return { error: err };

  const csFile = path.join(WORK, 'Astra.cs');
  const exeFile = path.join(WORK, 'Astra.exe');
  fs.writeFileSync(csFile, CSHARP, 'utf8');

  const csc = [
    'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    'C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe',
  ].find(p => fs.existsSync(p));
  if (!csc) return { error: 'csc.exe не найден' };

  const args = ['/nologo', '/target:winexe', `/out:${exeFile}`,
    `/win32icon:${path.join(WORK, 'astra.ico')}`,
    '/r:System.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Net.dll',
    `/r:${path.join(WORK, 'Microsoft.Web.WebView2.Core.dll')}`,
    `/r:${path.join(WORK, 'Microsoft.Web.WebView2.WinForms.dll')}`,
    csFile];
  const r = spawnSync(csc, args, { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(exeFile)) {
    return { error: ((r.stderr || '') + (r.stdout || '')).slice(0, 900) };
  }
  return { exe: exeFile };
}

function launch({ detached = true } = {}) {
  const b = build();
  if (b.error) return b;
  const child = spawn(b.exe, [], { detached, stdio: 'ignore', cwd: WORK });
  if (detached) child.unref();
  return { pid: child.pid, exe: b.exe };
}

module.exports = { build, launch };

if (require.main === module) {
  console.log(JSON.stringify(build(), null, 2));
}
