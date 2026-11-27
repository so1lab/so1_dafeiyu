// 事实日志与生活状态分开：计划不是完成，文件归档也不等于送件演出完成。
const fs=require('node:fs'),path=require('node:path');
const names={quiet:'安静陪伴',observe:'观察',stretch:'伸展',play:'玩耍',stroll:'散步',rest:'休息',nap:'打盹',wake:'起床',
  receive:'吞件',walk:'送件步行',place:'投放演出',magic:'施法',celebrate:'等夸',external:'宿主动作',discover_file:'发现桌面新增文件',approach_file:'小跑靠近桌面文件',peek_file:'偷偷看桌面文件',disdain_file:'一脸嫌弃'};
const types=new Set(['activity.requested','activity.started','activity.completed','activity.interrupted','activity.failed','activity.phase','activity.paused',
  'user.pointer_down','user.clicked','user.dragged','user.file_hover','user.position_settled','user.opened_menu','user.opened_chat','user.opened_todo',
  'user.opened_warehouse','user.chatted','user.fed','user.corrected','user.undo','user.requested_resume','task.queued','task.started','task.file_filed','task.filed','task.failed',
  'task.delivery_completed','task.delivery_interrupted','environment.locked','environment.resumed','system.started',
  'desktop.detected','desktop.reacted','desktop.target','desktop.arrived','desktop.dialogue','desktop.stationary','desktop.cancelled']);
const text=(value,n=100)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,n):'';
function describe(e) {
  const d=e.details,a=names[d.activity] || '活动';
  const fixed={'user.pointer_down':'你开始操作桌宠','user.clicked':'你点击了我','user.dragged':'你拖动了我',
    'user.file_hover':'你把文件拖到了我身上，尚未投放','user.position_settled':'你把我放在了新位置',
    'user.opened_menu':'桌宠菜单已打开','user.opened_chat':'聊天面板已打开','user.opened_todo':'待办面板已打开',
    'user.opened_warehouse':'你打开了大肥鱼仓库','user.chatted':'你发来了一条聊天消息','user.corrected':'你调整了文件分类','user.undo':'你请求撤销文件操作',
    'user.requested_resume':'你要求继续刚才的小活动','environment.locked':'电脑锁屏或进入休眠','environment.resumed':'系统恢复运行',
    'system.started':'生活系统启动，旧动作不会自动重放'};
  if(fixed[e.type])return fixed[e.type]+(d.direction?'（'+d.direction+'）':'');
  if(e.type==='user.fed')return `你投喂了 ${d.count || 0} 份文件`;
  if(e.type==='desktop.detected')return '桌面出现新文件：'+d.name+'（只读取元数据，尚未读取正文或移动）';
  if(e.type==='desktop.reacted')return '已用动作回应桌面新文件：'+d.name+'；等待图标可见后再靠近';
  if(e.type==='desktop.target')return '准备靠近桌面文件：'+d.name;
  if(e.type==='desktop.arrived')return '已走到桌面文件旁边：'+d.name+'；文件仍在原位置';
  if(e.type==='desktop.stationary')return '在原地回应了桌面新文件';
  if(e.type==='desktop.dialogue')return '展示了桌面观察台词';
  if(e.type==='desktop.cancelled')return '靠近桌面文件的动作已取消：'+(d.reason || '用户操作或目标变化');
  if(e.type==='task.started')return '开始处理文件，尚未确认成功';
  if(e.type==='task.queued')return '文件已排队，尚未开始处理';
  if(e.type==='task.file_filed')return `本批新归档 ${d.count || 0} 份文件${d.folders?.length?'，分类：'+d.folders.join('、'):''}`;
  if(e.type==='task.filed')return `本批合计已实际归档 ${d.count || 0} 份文件${d.folders?.length?'，分类：'+d.folders.join('、'):''}；这是合计，不与逐份记录重复累加，也不代表送件演出完成`;
  if(e.type==='task.failed')return '文件处理未能全部完成';
  if(e.type==='task.delivery_completed')return '送件、回程与等夸演出已完成';
  if(e.type==='task.delivery_interrupted')return '送件演出未完成，已归档的文件不重复移动';
  if(e.type==='activity.requested')return '准备'+a+'，尚未确认开始';
  if(e.type==='activity.started')return '实际开始'+a;
  if(e.type==='activity.paused')return a+'暂时暂停：'+(d.reason || '播放暂停');
  if(e.type==='activity.completed')return a+'已结束';
  if(e.type==='activity.phase')return a+'进入'+(d.phase || '下一阶段');
  if(e.type==='activity.failed')return a+'未成功执行：'+(d.reason || '未确认播放');
  return a+'被打断：'+(d.reason || '情境变化')+'；后续策略：'+(d.decision || '重新安排');
}
module.exports=function experience(data) {
  const file=path.join(data,'experiences.jsonl'),facts=[],ids=new Set(),self=new Map(),previous=new Map();
  function reduce(e){
    const d=e.details;
    if(e.type.startsWith('activity.')) {
      const status={'activity.requested':'preparing','activity.started':'running','activity.paused':'paused','activity.completed':'completed',
        'activity.interrupted':'interrupted','activity.failed':'failed'}[e.type];
      const before=self.get(e.petId);
      if(before && before.runId!==d.runId && ['completed','interrupted','failed'].includes(status))return;
      if(status || (before?.runId===d.runId))self.set(e.petId,{...before,...d,status:status || before.status,at:e.at});
      if(e.type==='activity.interrupted' && !['quiet','external'].includes(d.activity))previous.set(e.petId,{...d,at:e.at});
    }
    if(e.type==='user.dragged' && previous.has(e.petId))previous.set(e.petId,{...previous.get(e.petId),
      decision:'留在用户选择的位置，放弃旧路线',interruptedBy:'用户拖动'});
  }
  try {for(const line of fs.readFileSync(file,'utf8').split('\n')){try{const e=JSON.parse(line);if(e.id&&types.has(e.type)){facts.push(e);ids.add(e.id);reduce(e);}}catch{}}}catch{}
  while(facts.length>2000){ids.delete(facts.shift().id);}
  function append(raw) {
    if(!raw || !types.has(raw.type) || typeof raw.id!=='string' || raw.id.length>200 || ids.has(raw.id))return false;
    const d=raw.details || {},details={};
    for(const key of ['runId','episodeId','activity','phase','reason','decision','direction','batch','interruptedBy','source','name','clip','line'])if(d[key])details[key]=text(d[key]);
    if(d.path)details.path=text(d.path,1000);
    for(const key of ['x','y'])if(Number.isFinite(d[key]))details[key]=d[key];
    if(Number.isSafeInteger(d.count)&&d.count>=0)details.count=Math.min(d.count,10000);
    if(Array.isArray(d.folders))details.folders=d.folders.filter(x=>typeof x==='string').slice(0,8).map(x=>text(x,40));
    const e={id:raw.id,petId:text(raw.petId,80) || 'main',at:Number.isFinite(raw.at)?raw.at:Date.now(),type:raw.type,
      actor:raw.type.startsWith('user.')?'user':raw.type.startsWith('activity.')?'pet':'system',details};
    e.text=describe(e);fs.appendFileSync(file,JSON.stringify(e)+'\n','utf8');facts.push(e);ids.add(e.id);reduce(e);
    if(facts.length>2000){while(facts.length>2000)ids.delete(facts.shift().id);
      fs.writeFileSync(file+'.tmp',facts.map(x=>JSON.stringify(x)).join('\n')+'\n');fs.renameSync(file+'.tmp',file);}
    return true;
  }
  let seq=0;const session=Date.now()+'-'+process.pid;
  function record(petId,type,details={}){append({id:session+':host:'+(++seq),petId,type,details,at:Date.now()});}
  // 进程退出前未确认的活动只能标记中断，不能当作已完成或重放。
  for(const [petId,current] of self)if(['running','preparing','paused'].includes(current.status))
    record(petId,'activity.interrupted',{...current,reason:'应用重启，后续执行未确认',decision:'重新安排'});
  return {append,record,timeline:petId=>facts.filter(e=>e.petId===petId),since(petId,id){const rows=facts.filter(e=>e.petId===petId),index=rows.findIndex(e=>e.id===id);return index<0?rows:rows.slice(index+1);},view(petId,query='') {
    const rows=facts.filter(e=>e.petId===petId),terms=String(query).match(/[\u3400-\u9fff]{2}|[a-zA-Z]{3,}/g) || [];
    const relevant=query?rows.filter(e=>terms.some(t=>e.text.includes(t) || JSON.stringify(e.details).includes(t))).slice(-12):[];
    return {current:self.get(petId) || null,previous:previous.get(petId) || null,recent:rows.slice(-24),relevant};
  }};
};
module.exports.names=names;
