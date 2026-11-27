const {BrowserWindow}=require('electron');
const path=require('node:path');
const installFeedMenu=require('./feed-menu.cjs');
const presentWindow=require('./present-window.cjs');

module.exports=function setupFeed(pets){
  let panel;
  const installCode='('+installFeedMenu.toString()+')()';
  for(const pet of pets.values()){
    if(pet.isDestroyed())continue;
    const install=()=>pet.webContents.executeJavaScript(installCode).catch(error=>{
      if(!pet.isDestroyed())console.warn('[inbox] 大肥鱼菜单加载失败',error.message);
    });
    pet.webContents.on('did-finish-load',install);
    if(!pet.webContents.isLoadingMainFrame())void install();
  }

  return function showRecommendation(){
    if(panel && !panel.isDestroyed()){
      presentWindow(panel);
      return;
    }
    const window=new BrowserWindow({
      title:'我的算力推荐',width:430,height:660,minWidth:350,minHeight:435,show:false,
      autoHideMenuBar:true,backgroundColor:'#f5f7fb',
      webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}
    });
    panel=window;
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.on('closed',()=>{panel=null;});
    presentWindow(window);
    window.loadFile(path.join(__dirname,'feed.html')).catch(error=>{
      console.warn('[inbox] 算力推荐窗口加载失败',error.message);
      if(!window.isDestroyed())window.close();
    });
  };
};
