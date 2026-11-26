param([Parameter(Mandatory=$true)][string]$Folder,[switch]$NoGateway,[switch]$Reveal,[long]$PetHwnd=0,[switch]$Snapshot,[switch]$OpenAndLocate,[switch]$Prepared,[long]$CloseHwnd=0,[switch]$DesktopOnly,[switch]$DesktopDebug)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PetHit {
 [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32")] public static extern bool ShowWindowAsync(IntPtr h,int mode);
 [DllImport("user32")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32")] public static extern IntPtr FindWindow(string c,string n);
 [DllImport("user32")] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr prev,string c,string n);
 [DllImport("user32")] public static extern IntPtr WindowFromPoint(System.Drawing.Point p);
 [DllImport("user32")] public static extern IntPtr GetAncestor(IntPtr h,uint mode);
 public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
 [DllImport("user32")] public static extern bool EnumWindows(EnumProc fn, IntPtr data);
 [DllImport("user32")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc fn, IntPtr data);
 [DllImport("user32",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd,System.Text.StringBuilder name,int count);
 static string ClassOf(IntPtr hwnd){var s=new System.Text.StringBuilder(128);GetClassName(hwnd,s,s.Capacity);return s.ToString();}
 public static IntPtr DesktopView(){
   IntPtr result=IntPtr.Zero;
   EnumWindows((top,data)=>{
     string c=ClassOf(top);if(c!="Progman" && c!="WorkerW")return true;
     EnumChildWindows(top,(child,unused)=>{
       if(ClassOf(child)!="SHELLDLL_DefView")return true;
       EnumChildWindows(child,(list,none)=>{if(ClassOf(list)=="SysListView32"){result=list;return false;}return true;},IntPtr.Zero);
       return result==IntPtr.Zero;
     },IntPtr.Zero);
     return result==IntPtr.Zero;
   },IntPtr.Zero);
   return result;
 }

}
"@ -ReferencedAssemblies System.Drawing
$null=[PetHit]::SetThreadDpiAwarenessContext([intptr](-4))
$ae=[Windows.Automation.AutomationElement]
$desc=[Windows.Automation.TreeScope]::Descendants
$shell=New-Object -ComObject Shell.Application
$folderPath=[IO.Path]::GetFullPath($Folder).TrimEnd('\')
# 只关闭本次新建、仍停留在目标父目录且没有额外标签页的窗口。
if($Snapshot){
    $ids=@($shell.Windows() | ForEach-Object {[long]$_.HWND})
    ConvertTo-Json -InputObject $ids -Compress
    exit
}
if($CloseHwnd){
    $windows=@($shell.Windows() | Where-Object {$_.HWND -eq $CloseHwnd})
    if($windows.Count -eq 1 -and $windows[0].Document.Folder.Self.Path -eq [IO.Path]::GetDirectoryName($folderPath)){
        $el=$ae::FromHandle([intptr]$CloseHwnd)
        $tabs=$el.FindAll($desc,[Windows.Automation.PropertyCondition]::new($ae::ControlTypeProperty,[Windows.Automation.ControlType]::TabItem))
        if($tabs.Count -le 1){$windows[0].Quit()}
    }
    exit
}
function DesktopList {
    # Win11 中 DefView 可能不是 WorkerW/Progman 的直接子窗口。
    [PetHit]::DesktopView()
}
function Locate($scope,$item,$handle,$kind){
    if(!$scope){return}
    $cond=[Windows.Automation.PropertyCondition]::new($ae::NameProperty,[string]$item.Name)
    # 隐藏扩展名时不同文件可能同显示名；不猜测坐标。
    if($DesktopOnly){
        $same=@($shell.Namespace(0).Items() | Where-Object {$_.Name -eq $item.Name})
        if($same.Count -ne 1){return}
    }
    foreach($el in $scope.FindAll($desc,$cond)){
        if($el.Current.ControlType -notin @([Windows.Automation.ControlType]::ListItem,[Windows.Automation.ControlType]::DataItem) -or $el.Current.IsOffscreen){continue}
        $r=$el.Current.BoundingRectangle
        if($r.IsEmpty -or $r.Width -lt 4 -or $r.Height -lt 4){continue}
        # 详细信息视图中整行可能很宽，落点取名称一侧；大图标取上半部。
        $x=[int]($r.Left+[Math]::Min($r.Width/2,33));$y=[int]($r.Top+[Math]::Min($r.Height*.45,29))
        $hit=[PetHit]::WindowFromPoint([Drawing.Point]::new($x,$y))
        $visible=[PetHit]::GetAncestor($hit,2) -in @([PetHit]::GetAncestor($handle,2),[intptr]$PetHwnd)
        if($DesktopOnly){return @{x=$x;y=$y;kind=$kind;visible=$visible}}
        if(!$visible){continue}
        return @{x=$x;y=$y;kind=$kind}
    }
}
function VerifyDesktop($allowParent){
    $hw=DesktopList
    if(!$hw -or $hw -eq [intptr]::Zero){return}
    $scope=$ae::FromHandle($hw)
    foreach($item in $shell.Namespace(0).Items()){
        try{
            $dest=$item.Path
            if($item.IsLink -and !$DesktopOnly){$dest=$item.GetLink.Target.Path}
            if(!$dest){continue}
            $dest=$dest.TrimEnd('\')
            if($dest -eq $folderPath -and !$allowParent){$r=Locate $scope $item $hw 'desktop'}
            elseif($allowParent -and $folderPath.StartsWith($dest+'\',[StringComparison]::OrdinalIgnoreCase)){$r=Locate $scope $item $hw 'gateway'}
            else{continue}
            if($r){return $r}
        }catch{}
    }
}
function FindExplorerItem {
    $parent=[IO.Path]::GetDirectoryName($folderPath)
    foreach($win in $shell.Windows()){
        try{
            if($win.Document.Folder.Self.Path -ne $parent){continue}
            $item=$win.Document.Folder.ParseName([IO.Path]::GetFileName($folderPath))
            if(!$item -or $item.Path -ne $folderPath){continue}
            $hw=[intptr]$win.HWND
            if(![PetHit]::IsWindowVisible($hw)){continue}
            $scope=$ae::FromHandle($hw)
            if($Reveal){
                if([PetHit]::IsIconic($hw)){$null=[PetHit]::ShowWindowAsync($hw,9)}
                if(-not [PetHit]::SetForegroundWindow($hw)){(New-Object -ComObject WScript.Shell).SendKeys("%");$null=[PetHit]::SetForegroundWindow($hw)}
                $null=[PetHit]::SetWindowPos($hw,[intptr]::Zero,0,0,0,0,0x13)
                $win.Document.SelectItem($item,29)

            }
            $list=$scope.FindFirst($desc,[Windows.Automation.PropertyCondition]::new($ae::ClassNameProperty,'UIItemsView'))
            if(!$list){continue}
            $r=Locate $list $item $hw 'explorer'
            if($r){$r.hwnd=[long]$hw;return $r}
        }catch{}
    }
}
function ShellDesktopPoint {
    try {
        Add-Type -Path (Join-Path $PSScriptRoot 'desktop-shell.cs') -ReferencedAssemblies System.Core,Microsoft.CSharp
        $p=[FishDesktopShell]::Locate($folderPath)
        if(!$p){return}
        $hw=[intptr]$p.Hwnd
        $hit=[PetHit]::WindowFromPoint([Drawing.Point]::new($p.X,$p.Y))
        $visible=[PetHit]::IsWindowVisible($hw) -and ([PetHit]::GetAncestor($hit,2) -in @([PetHit]::GetAncestor($hw,2),[intptr]$PetHwnd))
        return @{x=$p.X;y=$p.Y;kind='desktop';visible=$visible;source='shell-view'}
    }catch{if($DesktopDebug){[Console]::Error.WriteLine($_.Exception.Message)}}
}
if($DesktopDebug){
    $hw=DesktopList
    $items=@($shell.Namespace(0).Items() | Where-Object {$_.Path -eq $folderPath})
    $details=@();$partial=@();$total=0
    if($hw){
        $scope=$ae::FromHandle($hw)
        $stem=[IO.Path]::GetFileNameWithoutExtension($folderPath)
        $all=$scope.FindAll($desc,[Windows.Automation.Condition]::TrueCondition)
        $total=$all.Count
        foreach($candidate in $all){
            if($candidate.Current.Name.StartsWith($stem)){$partial+=@{name=$candidate.Current.Name;type=$candidate.Current.ControlType.ProgrammaticName;offscreen=$candidate.Current.IsOffscreen}}
        }
        foreach($item in $items){
            $cond=[Windows.Automation.PropertyCondition]::new($ae::NameProperty,[string]$item.Name)
            foreach($el in $scope.FindAll($desc,$cond)){
                $r=$el.Current.BoundingRectangle
                $details+=@{name=$el.Current.Name;type=$el.Current.ControlType.ProgrammaticName;offscreen=$el.Current.IsOffscreen;x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}
            }
        }
    }
    @{hwnd=[long]$hw;shellMatches=$items.Count;names=@($items|ForEach-Object {$_.Name});elements=$details;partial=$partial;total=$total;visible=[PetHit]::IsWindowVisible($hw);shellPoint=(ShellDesktopPoint)}|ConvertTo-Json -Depth 5 -Compress
    exit
}
if($DesktopOnly){
    $r=ShellDesktopPoint
    if(!$r){$r=VerifyDesktop $false}
    if($r){$r|ConvertTo-Json -Compress}else{'null'}
    exit
}
if($Prepared){
    # Receive the resolved destination as data after UI Automation and COM have loaded.
    [Console]::Out.WriteLine('ready')
    $line=[Console]::ReadLine()
    if(!$line){exit}
    $decoded=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
    $reuseParent=[IO.Path]::GetDirectoryName($folderPath)
    $reuseHwnd=0
    if($decoded.StartsWith('{')){
        $request=$decoded|ConvertFrom-Json
        $folderPath=[IO.Path]::GetFullPath($request.folder)
        $reuseHwnd=[long]$request.reuseHwnd
    }else{$folderPath=[IO.Path]::GetFullPath($decoded)}
    if(!(Test-Path -LiteralPath $folderPath -PathType Container)){'null';exit}
    $r=VerifyDesktop $false
    if(!$r){$r=FindExplorerItem}

    if($r){$r|ConvertTo-Json -Compress;exit}
    $OpenAndLocate=$true
}
if($OpenAndLocate){
    # Window ownership and icon readiness are checked inside the same process.
    $before=@($shell.Windows() | ForEach-Object {[long]$_.HWND})
    $watch=[Diagnostics.Stopwatch]::StartNew()
    $reused=$false
    if($reuseHwnd){
        foreach($win in $shell.Windows()){
            try{
                if([long]$win.HWND -ne $reuseHwnd -or $win.Document.Folder.Self.Path -ne $reuseParent){continue}
                $scope=$ae::FromHandle([intptr]$reuseHwnd)
                $tabs=$scope.FindAll($desc,[Windows.Automation.PropertyCondition]::new($ae::ControlTypeProperty,[Windows.Automation.ControlType]::TabItem))
                if($tabs.Count -gt 1){continue}
                $win.Navigate2([IO.Path]::GetDirectoryName($folderPath))
                $reused=$true
                break
            }catch{}
        }
    }
    if($reuseHwnd -and !$reused){'null';exit}
    if(!$reused){
    Start-Process explorer.exe -ArgumentList ('/select,"'+$folderPath+'"')
    }
    $Reveal=$true
    do {
        $r=FindExplorerItem
        if($r){
            $r.opened=($before -notcontains $r.hwnd -or ($reused -and $r.hwnd -eq $reuseHwnd))
            $r.readyMs=$watch.ElapsedMilliseconds
            $r|ConvertTo-Json -Compress
            exit
        }
        Start-Sleep -Milliseconds 40
    }while($watch.ElapsedMilliseconds -lt 3200)
    'null'
    exit
}
$r=VerifyDesktop $false
if(!$r){$r=FindExplorerItem}
if(!$r -and !$NoGateway){$r=VerifyDesktop $true}
if($r){$r|ConvertTo-Json -Compress}else{'null'}
