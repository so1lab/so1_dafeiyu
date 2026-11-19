const {BrowserWindow,ipcMain,shell,dialog}=require('electron');
const path=require('node:path');

module.exports=function library({pets,worker,root,queue}) {
  let panel;
  const fromPet=e=>e.senderFrame===e.sender.mainFrame && Array.from(pets.values()).some(p=>!p.isDestroyed() && p.webContents===e.sender);
  const fromPanel=e=>panel && !panel.isDestroyed() && panel.webContents===e.sender && e.senderFrame===e.sender.mainFrame;
  const entries=async()=>(await worker({action:'catalog'},root())).entries;
  function show(){
    if(panel && !panel.isDestroyed()){if(panel.webContents.getURL().endsWith('/replay.html'))panel.loadFile(path.join(__dirname,'library.html'));panel.show();panel.focus();return;}
    panel=new BrowserWindow({width:1180,height:760,minWidth:620,minHeight:380,title:'大肥鱼的文件总览',autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'library-preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
    let watcher,timer;
    try{
      watcher=require('node:fs').watch(root(),{recursive:true},()=>{
        clearTimeout(timer);timer=setTimeout(()=>{if(panel&&!panel.isDestroyed())panel.webContents.send('inbox:refresh');},450);
      });
      watcher.on('error',()=>watcher.close());
    }catch{/* 切回窗口时仍会核对磁盘。 */}
    panel.on('closed',()=>{clearTimeout(timer);watcher?.close();panel=null;});
    panel.loadFile(path.join(__dirname,'library.html'));
  }
  ipcMain.on('inbox:library',e=>{if(fromPet(e))show();});
  ipcMain.on('inbox:auto',(e,paths)=>{
    if(fromPet(e) && Array.isArray(paths) && paths.length && paths.every(p=>typeof p==='string' && path.isAbsolute(p)))
      queue({action:'drop',paths},BrowserWindow.fromWebContents(e.sender));
  });
  ipcMain.handle('inbox:entries',e=>{if(fromPanel(e))return worker({action:'catalog'},root());});
  ipcMain.handle('inbox:desk-move',(e,ids,folder)=>{
    if(fromPanel(e) && Array.isArray(ids) && ids.every(Number.isSafeInteger) && typeof folder==='string')
      return worker({action:'desk_move',ids,folder},root());
  });
  ipcMain.handle('inbox:desk-undo',(e,batch)=>{
    if(fromPanel(e) && typeof batch==='string')return worker({action:'desk_undo',batch},root());
  });
  ipcMain.handle('inbox:thumb',async(e,file,large)=>{
    if(!fromPanel(e) || typeof file!=='string' || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file))return '';
    try{
      const fs=require('fs').promises;
      const rel=path.relative(await fs.realpath(root()),await fs.realpath(file));
      if(rel.startsWith('..') || path.isAbsolute(rel))return '';
      return (await require('electron').nativeImage.createThumbnailFromPath(file,large===true?{width:800,height:480}:{width:150,height:96})).toDataURL();
    }catch{return '';}
  });
  ipcMain.handle('inbox:adjust',async(e,id)=>{
    if(!fromPanel(e))return;
    const picked=await dialog.showOpenDialog(panel,{title:'选择或新建资料库内的分类目录',defaultPath:root(),properties:['openDirectory','createDirectory']});
    if(!picked.canceled)await queue({action:'adjust',id,folder:picked.filePaths[0]});
  });
  ipcMain.handle('inbox:new-project',async(e,id)=>{
    if(!fromPanel(e))return;
    const picked=await dialog.showOpenDialog(panel,{title:'选择新项目的上级目录',defaultPath:root(),properties:['openDirectory']});
    if(!picked.canceled)await queue({action:'create_project',id,parent:picked.filePaths[0]});
  });
  ipcMain.handle('inbox:confirm',async(e,id)=>{
    if(!fromPanel(e))return;
    const row=(await entries()).find(x=>x.id===id && x.available && x.status==='已收纳' && x.category==='待确认');
    if(row?.suggestion)await queue({action:'adjust',id,folder:path.join(root(),row.suggestion)});
  });
  ipcMain.handle('inbox:alias',async(e,id,term)=>{
    if(fromPanel(e) && typeof term==='string')return !!await queue({action:'alias',id,term});
  });
  ipcMain.handle('inbox:root',async e=>{if(fromPanel(e))await shell.openPath(root());});
  ipcMain.handle('inbox:open-file',async(e,id)=>{
    if(!fromPanel(e))return;
    const row=(await entries()).find(x=>x.id===id && x.available);
    if(!row)return '文件位置已变化';
    // 可执行程序、脚本和快捷方式交给资源管理器，普通文档使用系统默认应用。
    const viewable=/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|png|jpe?g|webp|heic|gif|bmp|mp[34]|m4a|mov|wav|flac|mkv|zip)$/i;
    if(!viewable.test(row.name)){shell.showItemInFolder(row.path);return '';}
    return shell.openPath(row.path);
  });
  ipcMain.handle('inbox:relink',async(e,id)=>{
    if(!fromPanel(e))return;
    const r=await dialog.showOpenDialog(panel,{title:'选择仓库中对应的文件',defaultPath:root(),properties:['openFile']});
    if(!r.canceled)await queue({action:'relink',id,path:r.filePaths[0]});
  });
  ipcMain.handle('inbox:locate',async(e,id)=>{
    if(!fromPanel(e))return false;
    const row=(await entries()).find(x=>x.id===id && x.available);
    if(row)shell.showItemInFolder(row.path);
    return !!row;
  });
  return {show,refresh(){if(panel && !panel.isDestroyed())panel.webContents.send('inbox:refresh');}};
};
