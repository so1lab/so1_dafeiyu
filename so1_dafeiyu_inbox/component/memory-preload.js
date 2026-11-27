const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('fishNotebook',{
  view:pet=>ipcRenderer.invoke('inbox:memory-view',pet),
  change:(pet,request)=>ipcRenderer.invoke('inbox:memory-change',pet,request)
});
