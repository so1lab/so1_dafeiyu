// Run inside the dsh-pet desktop renderer, preserving its native menu and focus handling.
module.exports=function installFeedMenu(){
  const shared=typeof S!=='undefined'?S:null;
  if(!shared || typeof shared.mountContextMenu!=='function' || shared.fishFeedMenuInstalled)return;
  const mount=shared.mountContextMenu;
  const feed={label:'投喂大肥鱼',action:'fish-feed-recommendation'};
  const tools={label:'大肥鱼工具',children:[
    {label:'打开仓库',hint:'双击桌宠',action:'fish-open-warehouse'},
    {label:'记忆星图',action:'fish-memory-cabin'},
    {label:'生活设置',action:'fish-life-settings'}
  ]};
  const actions=new Set([feed.action,...tools.children.map(item=>item.action)]);
  shared.mountContextMenu=function(options){
    const tree=[...options.tree];
    tree.splice(tree.findIndex(item=>item.action==='open-site')+1,0,feed);
    const chat=tree.findIndex(item=>item.action==='chat');
    tree.splice(chat<0?tree.indexOf(feed)+1:chat+1,0,tools);
    return mount.call(this,{...options,tree,onAction(leaf){
      if(!actions.has(leaf?.action))return options.onAction(leaf);
      if(typeof sprites!=='undefined')sprites[0]?.closeMenu();
      window.postMessage({type:leaf.action},'*');
    }});
  };
  shared.fishFeedMenuInstalled=true;
};
