const {ipcRenderer,contextBridge}=require('electron');
contextBridge.exposeInMainWorld('library',{
  move:(ids,folder)=>ipcRenderer.invoke('inbox:desk-move',ids,folder),
  undo:batch=>ipcRenderer.invoke('inbox:desk-undo',batch),
  thumb:(file,large=false)=>ipcRenderer.invoke('inbox:thumb',file,large),
  openRoot:()=>ipcRenderer.invoke('inbox:root'),
  adjust:id=>ipcRenderer.invoke('inbox:adjust',id),
  newProject:id=>ipcRenderer.invoke('inbox:new-project',id),
  confirm:id=>ipcRenderer.invoke('inbox:confirm',id),
  alias:(id,term)=>ipcRenderer.invoke('inbox:alias',id,term),
  open:id=>ipcRenderer.invoke("inbox:open-file",id),
  relink:id=>ipcRenderer.invoke("inbox:relink",id),
  read:()=>ipcRenderer.invoke('inbox:entries'),
  locate:id=>ipcRenderer.invoke('inbox:locate',id),
  onChange:cb=>ipcRenderer.on('inbox:refresh',()=>cb())
});
