// Run inside the dsh-pet desktop renderer, preserving its native menu and focus handling.
module.exports=function installFeedMenu(){
  const shared=typeof S!=='undefined'?S:null;
  if(!shared || typeof shared.mountContextMenu!=='function' || shared.fishFeedMenuInstalled)return;
  const mount=shared.mountContextMenu;
  const action='fish-feed-recommendation';
  shared.mountContextMenu=function(options){
    const tree=[...options.tree];
    tree.splice(1,0,{label:'投喂大肥鱼',action});
    return mount.call(this,{...options,tree,onAction(leaf){
      if(leaf?.action!==action)return options.onAction(leaf);
      if(typeof sprites!=='undefined')sprites[0]?.closeMenu();
      window.postMessage({type:action},'*');
    }});
  };
  shared.fishFeedMenuInstalled=true;
};
