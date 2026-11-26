// Read-only desktop positions through the Shell view, including Win11 views without a UIA item tree.
// Interface order follows the Windows SDK. No selection, positioning or window activation methods are called.
// Shell view pattern: https://devblogs.microsoft.com/oldnewthing/20130318-00/?p=4933/
using System;
using System.Runtime.InteropServices;

public static class FishDesktopShell {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
    public sealed class Result { public int X,Y; public long Hwnd; public string Path; }
    [ComImport,Guid("6d5140c1-7436-11ce-8034-00aa006009fa"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ServiceProvider { [PreserveSig] int QueryService(ref Guid service,ref Guid iid,out IntPtr value); }
    [ComImport,Guid("000214E2-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ShellBrowser {
        [PreserveSig] int GetWindow(out IntPtr hwnd);
        [PreserveSig] int ContextSensitiveHelp(bool enter);
        void InsertMenusSB();void SetMenuSB();void RemoveMenusSB();void SetStatusTextSB();void EnableModelessSB();
        void TranslateAcceleratorSB();void BrowseObject();void GetViewStateStream();void GetControlWindow();void SendControlMsg();
        [PreserveSig] int QueryActiveShellView(out IntPtr view);
    }
    [ComImport,Guid("000214E3-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ShellView { [PreserveSig] int GetWindow(out IntPtr hwnd); [PreserveSig] int ContextSensitiveHelp(bool enter); }
    [ComImport,Guid("cde725b0-ccc9-4519-917e-325d72fab4ce"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface FolderView {
        [PreserveSig] int GetCurrentViewMode(out uint mode);
        [PreserveSig] int SetCurrentViewMode(uint mode);
        [PreserveSig] int GetFolder(ref Guid iid,[MarshalAs(UnmanagedType.IUnknown)] out object folder);
        [PreserveSig] int Item(int index,out IntPtr pidl);
        [PreserveSig] int ItemCount(uint flags,out int count);
        void Items();void GetSelectionMarkedItem();void GetFocusedItem();
        [PreserveSig] int GetItemPosition(IntPtr pidl,out Point point);
    }
    [DllImport("shell32")] static extern int SHGetIDListFromObject([MarshalAs(UnmanagedType.IUnknown)]object value,out IntPtr pidl);
    [DllImport("shell32")] static extern IntPtr ILCombine(IntPtr parent,IntPtr child);
    [DllImport("shell32")] static extern int SHGetNameFromIDList(IntPtr pidl,uint kind,out IntPtr name);
    [DllImport("user32")] static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
    static void Check(int hr){if(hr<0)Marshal.ThrowExceptionForHR(hr);}
    static void Release(object value){if(value!=null && Marshal.IsComObject(value))try{Marshal.ReleaseComObject(value);}catch{}}

    public static Result Locate(string target) {
        object windows=null,desktop=null,browserObject=null,viewObject=null,folder=null;
        IntPtr browserPtr=IntPtr.Zero,viewPtr=IntPtr.Zero,parent=IntPtr.Zero;
        try {
            windows=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("9BA05972-F6A8-11CF-A442-00A0C90A8F39")));
            dynamic shellWindows=windows;object location=0;object empty=null;int browserHwnd;
            desktop=shellWindows.FindWindowSW(ref location,ref empty,8,out browserHwnd,1);
            Guid service=new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837"),browserId=new Guid("000214E2-0000-0000-C000-000000000046");
            Check(((ServiceProvider)desktop).QueryService(ref service,ref browserId,out browserPtr));
            browserObject=Marshal.GetObjectForIUnknown(browserPtr);
            Check(((ShellBrowser)browserObject).QueryActiveShellView(out viewPtr));
            viewObject=Marshal.GetObjectForIUnknown(viewPtr);FolderView view=(FolderView)viewObject;
            IntPtr hwnd;Check(((ShellView)viewObject).GetWindow(out hwnd));
            Guid folderId=new Guid("000214E6-0000-0000-C000-000000000046");
            Check(view.GetFolder(ref folderId,out folder));Check(SHGetIDListFromObject(folder,out parent));
            int count;Check(view.ItemCount(2,out count));
            for(int index=0;index<count;index++) {
                IntPtr child=IntPtr.Zero,absolute=IntPtr.Zero,name=IntPtr.Zero;
                try {
                    if(view.Item(index,out child)<0 || child==IntPtr.Zero)continue;
                    absolute=ILCombine(parent,child);
                    if(absolute==IntPtr.Zero || SHGetNameFromIDList(absolute,0x80028000,out name)<0)continue;
                    string itemPath=Marshal.PtrToStringUni(name);
                    if(!String.Equals(itemPath,target,StringComparison.OrdinalIgnoreCase))continue;
                    Point point;Check(view.GetItemPosition(child,out point));
                    point.X+=32;point.Y+=24;ClientToScreen(hwnd,ref point);
                    return new Result {X=point.X,Y=point.Y,Hwnd=hwnd.ToInt64(),Path=itemPath};
                } finally {
                    if(name!=IntPtr.Zero)Marshal.FreeCoTaskMem(name);
                    if(absolute!=IntPtr.Zero)Marshal.FreeCoTaskMem(absolute);
                    if(child!=IntPtr.Zero)Marshal.FreeCoTaskMem(child);
                }
            }
            return null;
        } finally {
            if(parent!=IntPtr.Zero)Marshal.FreeCoTaskMem(parent);
            if(viewPtr!=IntPtr.Zero)Marshal.Release(viewPtr);
            if(browserPtr!=IntPtr.Zero)Marshal.Release(browserPtr);
            Release(folder);Release(viewObject);Release(browserObject);Release(desktop);Release(windows);
        }
    }
}
