// 生活信息放在独立面板，文件管理仍是双击后的主页。
(() => {
  const button=document.createElement('button');button.textContent='大肥鱼的生活';
  document.querySelector('#more').before(button);
  const panel=document.createElement('dialog');panel.className='life-panel';
  panel.innerHTML='<div class="bar"><h2>大肥鱼的生活</h2><button data-close>关闭</button></div>'+
    '<p class="life-intro">慢慢活动，安静陪伴。接到文件时，会先把你的事情做好。</p>'+
    '<div class="life-options"><label><input type="checkbox" data-enabled> 自主生活</label>'+
    '<label><input type="checkbox" data-quiet> 安静陪伴</label><label><input type="checkbox" data-ai> DeepSeek 规划</label>'+
    '<label><input type="checkbox" data-desktop> 桌面新文件靠近测试</label>'+
    '<label><input type="checkbox" data-dialogue-ai> DeepSeek 桌面台词</label></div>'+
    '<small>安静陪伴会暂停散步、玩耍等自主活动，仍然可以聊天和投喂。</small>'+
    '<div data-desktop-status></div><div data-state role="status"></div><div data-planner></div><button data-replan>重新规划</button> <button data-resume hidden>继续刚才的小活动</button><h3>最近的小经历</h3><ol data-history></ol>'+
    '<small>规划只发送简要状态与近期小经历，通过 dsh 已配置的 DeepSeek 调用。文件正文和其它应用内容不进入生活规划。</small>';
  document.body.append(panel);
  let timer,loading=false,pendingPatch=null;
  const enabled=panel.querySelector('[data-enabled]'),quiet=panel.querySelector('[data-quiet]'),ai=panel.querySelector('[data-ai]');
  const desktopToggle=panel.querySelector('[data-desktop]');
  const dialogueAI=panel.querySelector('[data-dialogue-ai]');
  async function render(patch) {
    if(loading){if(patch)pendingPatch={...pendingPatch,...patch};return;} loading=true;
    try {
      const status=await library.life(patch);if(!status)return;
      enabled.checked=status.enabled;quiet.checked=status.quiet;quiet.disabled=!status.enabled;
      ai.checked=status.ai!==false;ai.disabled=!status.enabled;
      const desktop=status.desktop;desktopToggle.checked=!!desktop?.enabled;
      dialogueAI.checked=!!desktop?.dialogueAI;dialogueAI.disabled=!desktop?.enabled;
      const desktopStatus=panel.querySelector('[data-desktop-status]');desktopStatus.replaceChildren();
      if(desktop?.enabled){
        const labels={starting:'正在建立桌面存量快照',watching:'已就绪，等待新文件',locating:'正在查找新文件图标',
          'waiting-pet':'等待桌宠空闲并可移动',reacting:'正在回应新文件',reacted:'已发现文件，准备定位桌面图标','waiting-desktop':'等待桌面图标可见且能够准确定位',
          approaching:'正在靠近文件',arrived:'已到文件旁边',cancelled:'靠近已取消',skipped:'文件已离开桌面或等待超时',error:'观察暂时不可用'};
        const summary=document.createElement('small');summary.textContent='桌面观察：'+(labels[desktop.phase] || desktop.phase);desktopStatus.append(summary);
        if(desktop.last){const file=document.createElement('small');file.textContent=desktop.last.name+' · '+desktop.last.path;file.style.overflowWrap='anywhere';desktopStatus.append(file);}
        if(Number.isFinite(desktop.last?.x) && Number.isFinite(desktop.last?.y)){
          const position=document.createElement('small');position.textContent='图标位置：('+Math.round(desktop.last.x)+', '+Math.round(desktop.last.y)+')'+(desktop.last.visible===false?' · 当前被遮挡或隐藏':'');desktopStatus.append(position);
        }
        if(desktop.error){const problem=document.createElement('small');problem.textContent='最近提示：'+desktop.error;desktopStatus.append(problem);}
        const notice=document.createElement('small');
        notice.textContent='开启 DeepSeek 桌面台词后，靠近时会发送文件名及最多 900 字可提取正文，用于生成两句台词。';
        desktopStatus.append(notice);
      }
      const body=panel.querySelector('[data-state]'),history=panel.querySelector('[data-history]');
      const planning=panel.querySelector('[data-planner]');planning.replaceChildren();
      panel.querySelector('[data-replan]').disabled=!status.enabled || status.quiet || status.ai===false;
      body.replaceChildren();history.replaceChildren();
      if(!status.pets.length)body.textContent='等待桌宠就绪…';
      for(const pet of status.pets) {
        const row=document.createElement('p');row.textContent=!status.enabled?'自主生活已暂停':pet.reason;
        const current=pet.awareness?.current,previous=pet.awareness?.previous;
        const names={quiet:'安静陪伴',observe:'观察',stretch:'伸展',play:'玩耍',stroll:'散步',rest:'休息',nap:'打盹',wake:'起床',receive:'吞件',walk:'送件步行',place:'投放',magic:'施法',celebrate:'等夸',external:'宿主动作',discover_file:'发现桌面新增文件',approach_file:'小跑靠近桌面文件',peek_file:'偷偷看桌面文件',disdain_file:'一脸嫌弃'};
        const labelsSelf={preparing:'准备',running:'正在',paused:'暂停',completed:'刚刚结束',interrupted:'已被打断',failed:'未成功执行'};
        if(current && status.enabled)row.textContent=(labelsSelf[current.status] || '状态待确认')+' · '+(names[current.activity] || '活动');
        const detail=document.createElement('small');
        detail.textContent=`精力${pet.energy>65?'充足':pet.energy>35?'平稳':'偏低'} · ${pet.sleepiness>60?'有点困':'精神还不错'}${pet.home?' · 已记住你放我的位置':''}`;
        body.append(row,detail);
        if(previous){const line=document.createElement('small');line.textContent='刚才：'+(names[previous.activity] || '活动')+'被打断，'+previous.reason+'；'+previous.decision;body.append(line);}
        const resume=panel.querySelector('[data-resume]');resume.hidden=!pet.canResume;
        resume.disabled=!status.enabled || status.quiet || pet.activity==='task';
        const info=document.createElement('p'),request=pet.planner || {};
        const labels={waiting:'等待适合的时机',planning:'正在规划，当前活动照常进行',ready:'新计划已就绪',discarded:'情境已变化，继续本地活动',fallback:'本次规划未成功，继续本地活动',budget:'本小时规划次数已用完'};
        const reasons={'deepseek-unavailable':'未找到可用的 DeepSeek','model-unavailable':'宿主模型服务不可用','model-request-failed':'模型请求失败','timeout':'请求超时','invalid-response':'返回内容无法使用','invalid-step':'计划含不可用活动','too-frequent':'活动安排过于频繁','invalid-plan':'计划格式不完整','plan-too-long':'计划过长','empty-response':'模型没有返回内容'};
        info.textContent=status.ai===false?'DeepSeek 规划已关闭':(labels[request.status] || '本地活动中')+
          (request.reason && reasons[request.reason]?' · '+reasons[request.reason]:'');
        if(request.model)info.textContent+=' · '+request.model;
        planning.append(info);
        if(pet.planning?.goal){const goal=document.createElement('small');goal.textContent='接下来的打算：'+pet.planning.goal;planning.append(goal);}
        const source=document.createElement('small');source.textContent='当前活动来源：'+(pet.source==='deepseek'?'DeepSeek 阶段计划':'本地行为引擎');planning.append(source);
        for(const event of [...pet.history].reverse()) {
          const item=document.createElement('li'),time=new Date(event.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
          item.textContent=time+'　'+event.text;history.append(item);
        }
      }
      if(!history.children.length){const li=document.createElement('li');li.textContent='还没有新的小经历，先一起待一会儿。';history.append(li);}
    } catch { panel.querySelector('[data-state]').textContent='暂时无法读取状态，请稍后重试。'; }
    finally { loading=false;if(pendingPatch){const next=pendingPatch;pendingPatch=null;void render(next);} }
  }
  button.onclick=()=>{panel.showModal();void render();clearInterval(timer);timer=setInterval(()=>render(),2500);};
  panel.querySelector('[data-close]').onclick=()=>panel.close();
  panel.addEventListener('close',()=>clearInterval(timer));
  enabled.onchange=()=>render({enabled:enabled.checked});quiet.onchange=()=>render({quiet:quiet.checked});
  ai.onchange=()=>render({ai:ai.checked});panel.querySelector('[data-replan]').onclick=()=>render({replan:true});
  panel.querySelector('[data-resume]').onclick=()=>render({resume:true});
  desktopToggle.onchange=()=>render({desktop:desktopToggle.checked});
  dialogueAI.onchange=()=>render({dialogueAI:dialogueAI.checked});
})();
