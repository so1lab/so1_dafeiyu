param([Parameter(Mandatory=$true)][string]$Folder,[switch]$NoGateway,[switch]$Reveal,[long]$PetHwnd=0,[switch]$Snapshot,[switch]$OpenAndLocate,[switch]$Prepared,[long]$CloseHwnd=0)
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
    $hostWin=[PetHit]::FindWindow('Progman',$null)
    $view=[PetHit]::FindWindowEx($hostWin,[intptr]::Zero,'SHELLDLL_DefView',$null)
    $prev=[intptr]::Zero
    while($view -eq [intptr]::Zero){
        $prev=[PetHit]::FindWindowEx([intptr]::Zero,$prev,'WorkerW',$null)
        if($prev -eq [intptr]::Zero){return}
        $view=[PetHit]::FindWindowEx($prev,[intptr]::Zero,'SHELLDLL_DefView',$null)
    }
    [PetHit]::FindWindowEx($view,[intptr]::Zero,'SysListView32',$null)
}
function Locate($scope,$item,$handle,$kind){
    if(!$scope){return}
    $cond=[Windows.Automation.PropertyCondition]::new($ae::NameProperty,[string]$item.Name)
    foreach($el in $scope.FindAll($desc,$cond)){
        if($el.Current.ControlType -notin @([Windows.Automation.ControlType]::ListItem,[Windows.Automation.ControlType]::DataItem) -or $el.Current.IsOffscreen){continue}
        $r=$el.Current.BoundingRectangle
        if($r.IsEmpty -or $r.Width -lt 4 -or $r.Height -lt 4){continue}
        # 详细信息视图中整行可能很宽，落点取名称一侧；大图标取上半部。
        $x=[int]($r.Left+[Math]::Min($r.Width/2,33));$y=[int]($r.Top+[Math]::Min($r.Height*.45,29))
        $hit=[PetHit]::WindowFromPoint([Drawing.Point]::new($x,$y))
        if([PetHit]::GetAncestor($hit,2) -notin @([PetHit]::GetAncestor($handle,2),[intptr]$PetHwnd)){continue}
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
            if($item.IsLink){$dest=$item.GetLink.Target.Path}
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
