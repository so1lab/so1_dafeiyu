const { app, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

module.exports = function startInbox(pets,host) {
  const data = path.join(app.getPath('userData'), 'file-inbox');
  fs.mkdirSync(data, { recursive: true });
  const settings = path.join(data, 'settings.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(settings, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(settings, JSON.stringify(config));
  const life = require('./life.cjs')({pets,data,config,save});
  const docs=app.getPath('documents');
  const oldDefault=path.join(docs,'桌宠收纳箱');
  const custom=config.root && path.resolve(config.root)!==path.resolve(oldDefault);
  const desired=custom?config.root:path.join(docs,'大肥鱼仓库');
  const python=JSON.parse(fs.readFileSync(path.join(__dirname,'runtime.json'),'utf8')).python;
  const initialized=require('node:child_process').spawnSync(python,['-X','utf8',path.join(__dirname,'warehouse.py'),desired,custom?desired:oldDefault,data],
    {encoding:'utf8',windowsHide:true});
  if(initialized.status!==0){dialog.showErrorBox('大肥鱼仓库初始化失败',initialized.stderr || String(initialized.error));return;}
  const warehousePath=JSON.parse(initialized.stdout);
  const root=()=>warehousePath;
  function say(message) {
    for (const pet of pets.values()) {
      if (!pet.isDestroyed()) pet.webContents.send('inbox:parcel',{message});
    }
  }
  // 所有移动和撤销按投放顺序执行，防止两个批次同时占用同一目标文件名。
  let tail = Promise.resolve();
  let pending = 0;
  let databaseTail=Promise.resolve(), animationTail=Promise.resolve();
  function worker(req,target){
    const result=databaseTail.then(()=>runWorker(req,target));
    databaseTail=result.catch(()=>{});
    return result;
  }
  function runWorker(req, target) {
    return new Promise((resolve,reject) => {
      const python = JSON.parse(fs.readFileSync(path.join(__dirname,'runtime.json'))).python;
      const child = spawn(python,['-X','utf8',path.join(__dirname,'worker.py'),target,path.join(data,'history.sqlite')],
        {windowsHide:true,stdio:['pipe','pipe','pipe']});
      let result, errorText = '';
      child.on('error',reject);
      child.stdin.on('error',reject);
      child.stderr.on('data', d => {errorText = (errorText + d).slice(-400);});
      readline.createInterface({input:child.stdout}).on('line', line => {
        try {const event=JSON.parse(line); if(event.progress) say(event.progress); else result=event;} catch {}
      });
      child.on('close',code => code === 0 && result ? resolve(result) : reject(Error(errorText || 'Python 工作进程未完成')));
      child.stdin.end(JSON.stringify(req));
    });
  }
  const receipts=new WeakMap(), failures=new WeakMap(), walking=new WeakSet();
  const bites = new WeakMap(), mouthHolds = new WeakMap();
  function mouthAnimation(clip, stage) {
    if (typeof sprites === 'undefined' || !sprites[0]) return;
    const s = sprites[0];
    s.stopMove();
    s.stopThrow();
    s.switchTo(clip, stage !== 'ready');
    if (stage !== 'bite') return;
    const video = s.front === 0 ? s.videoB : s.videoA;
    // Keep the final bite frame visible while the target folder is being located.
    return new Promise(resolve => {
      const timeout = setTimeout(resolve, 4500);
      video.onended = () => { clearTimeout(timeout); resolve(); };
    });
  }
  const senderPet=e=>[...pets.values()].find(p=>!p.isDestroyed() && p.webContents===e.sender && e.senderFrame===e.sender.mainFrame);
  ipcMain.on('inbox:mouth-pose',(e,stage)=>{
    const pet=senderPet(e);
    if(!pet || walking.has(pet))return;
    if(!['ready','bite','leave'].includes(stage))return;
    mouthHolds.get(pet)?.(); mouthHolds.delete(pet);
    if(stage!=='leave') {
      const release=life.acquire(pet), timeout=setTimeout(release,15000);
      mouthHolds.set(pet,()=>{clearTimeout(timeout);release();});
    }
    if(config.reduced)return;
    const clip={ready:'啊呜等投喂',bite:'啊呜吞件',leave:'待机呼吸休闲'}[stage];
    if(typeof clip!=='string')return;
    const playback = pet.webContents.executeJavaScript(
      '(' + mouthAnimation.toString() + ')(' + JSON.stringify(clip) + ',' + JSON.stringify(stage) + ')'
    ).catch(()=>{});
    if(stage === 'bite') bites.set(pet, playback);
  });
  function arrived(pet,group){
    const receipt={group,taken:false,expires:Date.now()+3200};
    receipts.set(pet,receipt);
    pet.webContents.send('inbox:arrived','已放进「'+path.basename(group.folder)+'」');
    return receipt;
  }
  ipcMain.on('inbox:receipt-action',async(e,action)=>{
    const pet=senderPet(e);if(!pet)return;
    try{
      if(action==='retry'){
        const paths=failures.get(pet);failures.delete(pet);
        if(paths?.length)queue({action:'drop',paths},pet);
        return;
      }
      const token=receipts.get(pet);
      if(!token || Date.now()>token.expires || !['open','adjust'].includes(action))return;
      token.taken=true;receipts.delete(pet);
      const group=token.group;
      if(action==='open'){
        if(group.count>1){await shell.openPath(group.folder);return;}
        const f=path.join(group.folder,group.name);
        if(/\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|png|jpe?g|webp|heic|gif|bmp|mp[34]|m4a|mov|wav|flac)$/i.test(f)){
          const err=await shell.openPath(f);if(err)throw Error(err);
        }else shell.showItemInFolder(f);
      }else if(group.ids?.length){
        const choice=await dialog.showOpenDialog(pet,{title:'改放到仓库中的文件夹',defaultPath:root(),properties:['openDirectory','createDirectory']});
        if(!choice.canceled)for(const id of group.ids)await queue({action:'adjust',id,folder:choice.filePaths[0]},pet);
      }else library.show();
    }catch(err){say(err.message);}
  });
  function animate(pet,groups,allFiled=true){
    pet=pet || pets.values().next().value;
    const releaseLife=life.acquire(pet);
    animationTail=animationTail.then(async()=>{
      if(!pet || pet.isDestroyed())return;
      walking.add(pet);
      try{await require('./archive.cjs')(pet,groups,arrived,allFiled);}finally{walking.delete(pet);}
    })
      .catch(e=>console.warn('[inbox] 动画中断',e.message)).finally(releaseLife);
    return animationTail;
  }
  function queue(req,pet) {
    const releaseLife=life.acquire(pet);
    if(pet){mouthHolds.get(pet)?.();mouthHolds.delete(pet);}
    const bite = req.action === 'drop' && bites.get(pet);
    if (bite) bites.delete(pet);
    let delivering = false;
    const target = root();
    const archive=require('./archive.cjs');
    let finishJourney, classified=false;
    if(bite && !config.reduced && pet && !pet.isDestroyed() && pet.isVisible()){
      const destination=new Promise(resolve=>{finishJourney=resolve;});
      animationTail=animationTail.then(async()=>{
        if(pet.isDestroyed())return;
        const opened=new Set();
        const locator=archive.prepareLocator(pet,target);
        // 仅预热定位进程；必须等施法释放帧后才能提交目标并打开窗口。
        try{
          await bite;
          if(pet.isDestroyed() || !pet.isVisible())return;
          walking.add(pet);
          const batch=await destination;
          if(batch.groups.length && !pet.isDestroyed())
            await archive(pet,batch.groups,arrived,batch.complete,{locator,opened});
        }finally{
          walking.delete(pet);locator.cancel();
          const batch=await destination;
          if(opened.size && batch.groups.length)await archive.closeOpened(batch.groups[0].folder,opened);
        }
      }).catch(e=>console.warn('[inbox] 动画中断',e.message));
    }
    pending++;
    if(pending > 1) say('已排队 · ' + pending + ' 项任务');
    tail = tail.then(async () => {
      let result;
      if(req.action==='drop'){
        const batch=require('node:crypto').randomUUID(), groups=new Map();
        const paths=[...new Set(req.paths)];
        let done=0,success=0;
        const failed=[];
        for(const file of paths){
          const one={action:'drop',paths:[file],batch};
          const notice=setTimeout(()=>say('正在辨认 · '+(done+1)+'/'+paths.length),1000);
          try{if(host)one.plans=await require('./analyze.cjs')(one,target,worker,host);}
          finally{clearTimeout(notice);}
          result=await worker(one,target);
          if(!result.deliveries?.length && fs.existsSync(file))failed.push(file);
          for(const group of result.deliveries || []){
            success+=group.count;
            if(groups.has(group.folder)){const prior=groups.get(group.folder);prior.count+=group.count;prior.ids.push(...group.ids);}
            else {
              groups.set(group.folder,group);
            }
          }
          say('已处理 '+(++done)+'/'+paths.length+' · 已归档 '+success);
          library.refresh();
        }
        if(success>0)life.complete(pet);
        if(paths.length>1)result={message:'已归档 '+success+'/'+paths.length+' 项'};
        if(groups.size && !config.reduced){
          const first=[...groups.values()][0];
          if(paths.length===1)result.message=result.message+'，放进「'+path.basename(first.folder)+'」';
          else result.message='收好 '+success+' 份，分送 '+groups.size+' 个文件夹';
          if(paths.length===1)first.description=result.message;
          delivering = true;
          classified=true;
          if(finishJourney)finishJourney({groups:[...groups.values()],complete:success===paths.length});
          else animate(pet,[...groups.values()],success===paths.length);
        }
        if(failed.length && pet && !pet.isDestroyed()){
          failures.set(pet,failed);result.message=failed.length+' 份未能收纳，请核对原位置';
          pet.webContents.send('inbox:returned',{label:path.basename(failed[0]),message:result.message});
        }
      }else result=await worker(req,target);
      if (result.rows) {
        const content = result.rows.map(([src,dst,status,reason]) => [status,src,dst,reason].filter(Boolean).join('\n')).join('\n\n');
        const file = path.join(data,'最近收纳记录.txt');
        fs.writeFileSync(file,'\ufeff'+(content || '还没有投放记录。'));
        const err = await shell.openPath(file); if(err) throw Error(err);
      } else say(result.message);
      library.refresh();
      return result;
    }).catch(e => {say('操作失败 · 请查看提示'); dialog.showErrorBox('桌宠收纳箱',e.message);})
      .finally(async () => {
        pending--;
        // 文件已处理并不代表送件演出结束；身体占用直到这条演出链收尾才释放。
        animationTail.finally(releaseLife);
        classified=true;
        finishJourney?.({groups:[],complete:false});
        if (bite && !delivering) {
          await bite;
          if (!pet.isDestroyed()) await pet.webContents.executeJavaScript(
            "if(sprites[0]?.anim==='啊呜吞件') sprites[0].playOnce('待机呼吸休闲')"
          ).catch(()=>{});
        }
      });
    return tail;
  }
  async function openRoot() {
    try { fs.mkdirSync(root(),{recursive:true}); const err=await shell.openPath(root()); if(err) throw Error(err); }
    catch(e) { dialog.showErrorBox('打开收纳目录失败',e.message); }
  }
  const library=require('./library.cjs')({pets,worker,root,queue,life});
  const settingsMenu = win => [
    {label:'自主生活',type:'checkbox',checked:config.lifeEnabled!==false,click:item=>life.settings({enabled:item.checked})},
    {label:'安静陪伴',type:'checkbox',checked:!!config.lifeQuiet,click:item=>life.settings({quiet:item.checked})},
    {label:'问大肥鱼找文件',click:library.show},
    {label:'打开收纳目录',click:openRoot},
    {label:'精简搬运动画',type:'checkbox',checked:!!config.reduced,click:item=>{config.reduced=item.checked;save();}},
    {label:'最近收纳记录',click:()=>queue({action:'history'})},
    {label:'撤销最近一批',enabled:pending===0,click:()=>queue({action:'undo'})},
    {type:'separator'},
  ];
  require('./courier.cjs')({pets,config,save,queue,settingsMenu,root,animate});
};
