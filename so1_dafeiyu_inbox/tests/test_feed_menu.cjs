const assert=require('node:assert/strict');
const vm=require('node:vm');
const install=require('../component/feed-menu.cjs');

const delivered=[];
let closed=0;
const existing={label:'查看余额',action:'show-balance'};
const sender={postMessage(message){delivered.push(message.type);}};
const context=vm.createContext({
  S:{mountContextMenu:options=>options},
  sprites:[{closeMenu(){closed++;}}],
  window:sender
});
vm.runInContext('('+install.toString()+')()',context);
vm.runInContext('('+install.toString()+')()',context);
const root=[{label:'打开软件',action:'open-site'},existing,{label:'对话',action:'chat'}, {label:'动作',children:[]}];
const menu=context.S.mountContextMenu({tree:root,onAction:leaf=>delivered.push(leaf.action)});
assert.equal(root.length,4);
assert.deepEqual(Array.from(menu.tree,leaf=>leaf.label),['打开软件','投喂大肥鱼','查看余额','对话','大肥鱼工具','动作']);
const tools=menu.tree[4].children;
assert.deepEqual(Array.from(tools,leaf=>leaf.label),['打开仓库','记忆星图','生活设置']);
assert.equal(tools[0].hint,'双击桌宠');
menu.onAction(menu.tree[1]);
for(const leaf of tools)menu.onAction(leaf);
menu.onAction(existing);
assert.equal(closed,4);
assert.deepEqual(delivered,['fish-feed-recommendation','fish-open-warehouse','fish-memory-cabin','fish-life-settings','show-balance']);
console.log('PASS feed: native menu insertion, idempotence and action dispatch');
