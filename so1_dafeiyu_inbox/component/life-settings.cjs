const {BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
const presentWindow=require('./present-window.cjs');

module.exports=function lifeSettings({life,senderPet,pets,host}){
  const panels=new Map();
  ipcMain.on('inbox:life-settings-open',event=>{
    const pet=senderPet(event);
    const id=pet && [...pets].find(([,window])=>window===pet)?.[0];
    if(!id)return;
    const older=panels.get(id);
    if(older && !older.isDestroyed()){presentWindow(older);return;}
    const win=new BrowserWindow({
      title:'大肥鱼 · 生活设置',width:620,height:675,minWidth:420,minHeight:440,
      show:false,autoHideMenuBar:true,backgroundColor:'#f5f7fb',
      webPreferences:{preload:path.join(__dirname,'life-settings-preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}
    });
    panels.set(id,win);win.setMenu(null);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{if(panels.get(id)===win)panels.delete(id);});
    presentWindow(win);
    void win.loadFile(path.join(__dirname,'life-settings.html')).catch(error=>{
      console.warn('[inbox] 生活设置加载失败',error.message);
      if(!win.isDestroyed())win.close();
    });
  });
  const panelId=e=>e.senderFrame===e.sender.mainFrame &&
    [...panels].find(([,win])=>!win.isDestroyed() && win.webContents===e.sender)?.[0];
  ipcMain.handle('inbox:life',(e,patch)=>{
    const id=panelId(e);
    if(!id)return null;
    const status=patch?life.settings(patch):life.status();
    return {...status,pets:status.pets.filter(pet=>pet.id===id)};
  });
  ipcMain.handle('inbox:life-persona',async(e,edit)=>{
    const id=panelId(e);
    if(!id || typeof host!=='function')return {ok:false,reason:'unavailable'};
    if(edit!==undefined && (typeof edit?.prompt!=='string' || typeof edit.expected!=='string'))
      return {ok:false,reason:'invalid'};
    try{
      const result=await host('POST','/dsh-pet-7340/life-persona',JSON.stringify({
        id, ...(edit===undefined?{}:{prompt:edit.prompt,expected:edit.expected})
      }));
      return JSON.parse(result.body);
    }catch{return {ok:false,reason:'unavailable'};}
  });
};
