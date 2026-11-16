/**
 * Presence — окно аватара поверх всех окон (WinForms + WebView2).
 *
 * Настоящее C#-окно: без рамки, TopMost, прозрачный фон, внутри WebView2
 * (движок Edge), поэтому VRM/three.js работают так же, как в браузере.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const WORK = path.join(__dirname, 'data', 'pet-build');
const WV2 = path.join(__dirname, 'vendor', 'wv2');

const CSHARP = String.raw`
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

public class PetForm : Form
{
    private WebView2 web;
    private IntPtr handle = IntPtr.Zero;
    private bool dragging;
    private Point lastPoint;

    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x80;
    const int WS_EX_NOACTIVATE = 0x08000000;
    const uint SWP_NOSIZE = 0x1, SWP_NOACTIVATE = 0x10, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4;
    static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    public PetForm(string url, int x, int y, int w, int h)
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(x, y);
        Size = new Size(w, h);
        BackColor = Color.FromArgb(11, 11, 13);
        Text = "Presence Avatar";
        KeyPreview = false;

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(web);

        web.CoreWebView2InitializationCompleted += (s, e) =>
        {
            if (!e.IsSuccess) return;
            var st = web.CoreWebView2.Settings;
            st.AreDefaultContextMenusEnabled = false;
            st.IsStatusBarEnabled = false;
            st.AreDevToolsEnabled = false;
            st.IsZoomControlEnabled = false;
            web.CoreWebView2.Navigate(url);
        };

        Shown += async (s, e) =>
        {
            handle = this.Handle;
            int ex = GetWindowLong(handle, GWL_EXSTYLE);
            SetWindowLong(handle, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW);

            string dataDir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Presence", "webview2");
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
                await web.EnsureCoreWebView2Async(env);
            }
            catch { }
        };

        // держим окно сверху и прилипшим к краю активного окна
        var timer = new Timer();
        timer.Interval = 700;
        timer.Tick += (s, e) =>
        {
            if (handle == IntPtr.Zero) return;
            SetWindowPos(handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

            // прилипание к правому нижнему краю окна на переднем плане
            IntPtr fg = GetForegroundWindow();
            if (fg == handle || fg == IntPtr.Zero) return;
            int tl = GetWindowTextLength(fg);
            if (tl == 0 || !IsWindowVisible(fg)) return;
            RECT r;
            if (!GetWindowRect(fg, out r)) return;
            int ww = r.R - r.L, wh = r.B - r.T;
            if (ww < 300 || wh < 200) return;
            // не прилипаем к рабочему столу/панели задач
            var sb = new System.Text.StringBuilder(tl + 1);
            GetWindowText(fg, sb, sb.Capacity);
            string title = sb.ToString();
            if (title == "Program Manager" || title == "Рабочий стол") return;

            int nx = r.R - (int)(Width * 0.45);
            int ny = r.B - Height + 24;
            if (Math.Abs(nx - Location.X) > 4 || Math.Abs(ny - Location.Y) > 4)
                Location = new Point(Math.Max(-40, nx), Math.Max(0, ny));
        };
        timer.Start();

        // перетаскивание окна
        MouseDown += (s2, e2) => { if (e2.Button == MouseButtons.Left) { dragging = true; lastPoint = Cursor.Position; timer.Stop(); } };
        MouseUp += (s2, e2) => { dragging = false; timer.Start(); };
        MouseMove += (s2, e2) =>
        {
            if (!dragging) return;
            var p = Cursor.Position;
            Location = new Point(Location.X + (p.X - lastPoint.X), Location.Y + (p.Y - lastPoint.Y));
            lastPoint = p;
        };
    }
}

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string url = args.Length > 0 ? args[0] : "http://127.0.0.1:4780/pet.html";
        int x = args.Length > 1 ? int.Parse(args[1]) : 60;
        int y = args.Length > 2 ? int.Parse(args[2]) : 60;
        int w = args.Length > 3 ? int.Parse(args[3]) : 360;
        int h = args.Length > 4 ? int.Parse(args[4]) : 520;
        Application.Run(new PetForm(url, x, y, w, h));
    }
}
`;

function copyDlls() {
  fs.mkdirSync(WORK, { recursive: true });
  const files = [
    [path.join(WV2, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll'), 'Microsoft.Web.WebView2.Core.dll'],
    [path.join(WV2, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll'), 'Microsoft.Web.WebView2.WinForms.dll'],
    [path.join(WV2, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'), 'WebView2Loader.dll'],
  ];
  for (const [src, name] of files) {
    const dst = path.join(WORK, name);
    if (!fs.existsSync(src)) return `нет ${src}`;
    if (!fs.existsSync(dst) || fs.statSync(src).size !== fs.statSync(dst).size) fs.copyFileSync(src, dst);
  }
  return null;
}

function build() {
  const copyErr = copyDlls();
  if (copyErr) return { error: copyErr };

  const csFile = path.join(WORK, 'Pet.cs');
  const exeFile = path.join(WORK, 'Pet.exe');
  fs.writeFileSync(csFile, CSHARP, 'utf8');

  const csc = [
    'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    'C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe',
  ].find(p => fs.existsSync(p));
  if (!csc) return { error: 'csc.exe не найден' };

  if (fs.existsSync(exeFile) && fs.statSync(exeFile).mtimeMs > fs.statSync(csFile).mtimeMs) {
    return { exe: exeFile };
  }

  const args = ['/nologo', '/target:winexe', `/out:${exeFile}`,
    '/r:System.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    `/r:${path.join(WORK, 'Microsoft.Web.WebView2.Core.dll')}`,
    `/r:${path.join(WORK, 'Microsoft.Web.WebView2.WinForms.dll')}`,
    csFile];
  const r = spawnSync(csc, args, { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(exeFile)) {
    return { error: ((r.stderr || '') + (r.stdout || '')).slice(0, 700) };
  }
  return { exe: exeFile };
}

function launch({ url, x = 60, y = 60, w = 360, h = 520 }) {
  const b = build();
  if (b.error) return b;
  const child = spawn(b.exe, [url, String(x), String(y), String(w), String(h)], {
    detached: true, stdio: 'ignore', windowsHide: false, cwd: WORK,
  });
  child.unref();
  return { pid: child.pid, exe: b.exe };
}

module.exports = { launch, build };
