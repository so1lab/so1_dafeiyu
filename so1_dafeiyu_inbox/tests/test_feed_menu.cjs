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
const root=[{label:'打开软件',action:'open-site'},existing];
const menu=context.S.mountContextMenu({tree:root,onAction:leaf=>delivered.push(leaf.action)});
assert.equal(root.length,2);
assert.deepEqual(Array.from(menu.tree,leaf=>leaf.label),['打开软件','投喂大肥鱼','大肥鱼的记忆舱','查看余额']);
menu.onAction(menu.tree[1]);
menu.onAction(menu.tree[2]);
menu.onAction(existing);
assert.equal(closed,2);
assert.deepEqual(delivered,['fish-feed-recommendation','fish-memory-cabin','show-balance']);
console.log('PASS feed: native menu insertion, idempotence and action dispatch');
