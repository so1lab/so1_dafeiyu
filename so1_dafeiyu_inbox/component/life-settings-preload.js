const {ipcRenderer,contextBridge}=require('electron');
contextBridge.exposeInMainWorld('fishSettings',{
  life:patch=>ipcRenderer.invoke('inbox:life',patch),
  persona:edit=>ipcRenderer.invoke('inbox:life-persona',edit)
});
