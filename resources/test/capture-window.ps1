<#
.SYNOPSIS
  截取「本插件拉起的浏览器窗口」所在屏幕区域，供像素取证（例如确认页面底栏/操作栏是否真的
  显示在屏幕上——页面自报的 innerHeight 可能与窗口真实渲染区不一致）。

.NOTES
  本文件必须以「UTF-8 with BOM」保存：Windows PowerShell 5.1 会把无 BOM 的文件按 ANSI
  读取，中文字符串会直接解析失败（本机只装了 5.1）。

.DESCRIPTION
  按启动参数里的 profile 目录片段定位浏览器进程 → 取窗口矩形与渲染子窗口
  (Chrome_RenderWidgetHostHWND) 的真实尺寸 → 临时置顶 → 截屏 → 还原置顶状态，
  并把窗口/渲染区的物理与 CSS 尺寸打印出来（CSS = 物理 / (DPI/96)）。
  仅截屏与置顶，不改动目标进程、不删除任何文件。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File capture-window.ps1 `
    -ProfileMatch 'dsh-we-viewport-check-old' -OutPath 'D:\tmp\old.png'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProfileMatch,
  [Parameter(Mandatory = $true)][string]$OutPath
)

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public struct CaptureRect { public int Left; public int Top; public int Right; public int Bottom; }
public class CaptureWin32 {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out CaptureRect r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out CaptureRect r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  /** 返回渲染子窗口的 [宽,高]（物理像素）；找不到返回 0,0。 */
  public static int[] RendererSize(IntPtr parent) {
    var result = new int[] { 0, 0 };
    EnumChildWindows(parent, (h, l) => {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      if (sb.ToString().IndexOf("Chrome_RenderWidgetHostHWND", StringComparison.Ordinal) >= 0) {
        CaptureRect r; GetClientRect(h, out r);
        result[0] = r.Right - r.Left; result[1] = r.Bottom - r.Top;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
"@
Add-Type -AssemblyName System.Drawing

[void][CaptureWin32]::SetProcessDpiAwarenessContext([IntPtr](-4))

# 按 profile 目录片段找浏览器主进程（本插件每个浏览器一个 profile-<名字> 目录）
$proc = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe' OR Name='brave.exe' OR Name='opera.exe'" |
  Where-Object { $_.CommandLine -like "*$ProfileMatch*" -and $_.CommandLine -notlike '*--type=*' } |
  Select-Object -First 1
if (-not $proc) { throw "未找到命令行含 '$ProfileMatch' 的浏览器主进程" }

$browser = Get-Process -Id $proc.ProcessId
$hwnd = $browser.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "进程 $($proc.ProcessId) 没有主窗口" }

$wr = New-Object CaptureRect; [void][CaptureWin32]::GetWindowRect($hwnd, [ref]$wr)
$cr = New-Object CaptureRect; [void][CaptureWin32]::GetClientRect($hwnd, [ref]$cr)
$dpi = [CaptureWin32]::GetDpiForWindow($hwnd)
$scale = if ($dpi -gt 0) { $dpi / 96.0 } else { 1 }
$renderer = [CaptureWin32]::RendererSize($hwnd)
$winW = $wr.Right - $wr.Left; $winH = $wr.Bottom - $wr.Top

# 临时置顶（HWND_TOPMOST = -1），截完还原（HWND_NOTOPMOST = -2）；SWP_NOSIZE|SWP_NOMOVE
[void][CaptureWin32]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0003)
Start-Sleep -Milliseconds 900
$bmp = New-Object System.Drawing.Bitmap($winW, $winH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($wr.Left, $wr.Top, 0, 0, $bmp.Size)
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
[void][CaptureWin32]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, 0x0003)

[pscustomobject]@{
  pid              = $proc.ProcessId
  title            = $browser.MainWindowTitle
  dpi              = $dpi
  scale            = $scale
  windowPos        = "($($wr.Left),$($wr.Top))"
  windowPhysical   = "$winW x $winH"
  windowCss        = "$([math]::Round($winW / $scale)) x $([math]::Round($winH / $scale))"
  clientCss        = "$([math]::Round(($cr.Right - $cr.Left) / $scale)) x $([math]::Round(($cr.Bottom - $cr.Top) / $scale))"
  rendererPhysical = "$($renderer[0]) x $($renderer[1])"
  rendererCss      = "$([math]::Round($renderer[0] / $scale)) x $([math]::Round($renderer[1] / $scale))"
  outPath          = $OutPath
} | Format-List
