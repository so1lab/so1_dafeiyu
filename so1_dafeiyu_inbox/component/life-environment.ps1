# 只报告前台窗口的几何与进程号，不读取标题、正文或截图。
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class FishForeground {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder name, int count);
}
'@
[void][FishForeground]::SetThreadDpiAwarenessContext([IntPtr](-4))
while ($true) {
  $handle = [FishForeground]::GetForegroundWindow()
  $rect = New-Object FishForeground+Rect
  $ownerId = [uint32]0
  if ([FishForeground]::GetWindowRect($handle, [ref]$rect)) {
    [void][FishForeground]::GetWindowThreadProcessId($handle, [ref]$ownerId)
    $className=New-Object Text.StringBuilder 128
    [void][FishForeground]::GetClassName($handle,$className,$className.Capacity)
    $desktop=$className.ToString() -in @('Progman','WorkerW','SHELLDLL_DefView','SysListView32')
    @{x=$rect.Left; y=$rect.Top; width=$rect.Right-$rect.Left; height=$rect.Bottom-$rect.Top; pid=$ownerId; desktop=$desktop} | ConvertTo-Json -Compress
  }
  Start-Sleep -Seconds 5
}
