const {BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
const presentWindow=require('./present-window.cjs');

module.exports=function memoryPanel({life,senderPet,warehouse}){
  let panel,warehouseCache,warehouseRequest;
  async function withWarehouse(view){
    if(!view?.available)return view;
    if(!warehouseCache || Date.now()-warehouseCache.at>=12000){
      warehouseRequest ||= warehouse().then(result=>{
        warehouseCache={at:Date.now(),files:result.files};
      }).catch(()=>{
        warehouseCache={at:Date.now(),files:null};
      }).finally(()=>{warehouseRequest=null;});
      await warehouseRequest;
    }
    return {...view,warehouseFiles:warehouseCache.files};
  }
  ipcMain.on('inbox:memory-open',event=>{
    if(!senderPet(event))return;
    if(panel && !panel.isDestroyed()){
      presentWindow(panel);
      if(!panel.webContents.isLoadingMainFrame())panel.webContents.send('inbox:memory-focus-graph');
      return;
    }
    const win=new BrowserWindow({
      title:'大肥鱼的记忆舱',width:1060,height:730,minWidth:690,minHeight:510,show:false,
      autoHideMenuBar:true,backgroundColor:'#f5f7fb',
      webPreferences:{preload:path.join(__dirname,'memory-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}
    });
    panel=win;warehouseCache=null;win.setMenu(null);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    win.on('closed',()=>{if(panel===win)panel=null;});
    // Opening the panel must not depend on a first paint or on the warehouse query.
    presentWindow(win);
    win.loadFile(path.join(__dirname,'memory.html')).catch(error=>{
      console.warn('[fish-memory] 记忆舱打开失败',error.message);
      if(!win.isDestroyed())win.close();
    });
  });
  const fromPanel=e=>panel && !panel.isDestroyed() && e.sender===panel.webContents && e.senderFrame===e.sender.mainFrame;
  ipcMain.handle('inbox:memory-view',(e,id)=>fromPanel(e)?withWarehouse(life.memoryView(id)):null);
  ipcMain.handle('inbox:memory-change',(e,id,request)=>fromPanel(e)&&request&&typeof request==='object'?withWarehouse(life.memoryChange(id,request)):null);
};
