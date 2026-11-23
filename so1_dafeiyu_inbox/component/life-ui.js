// 生活信息放在独立面板，文件管理仍是双击后的主页。
(() => {
  const button=document.createElement('button');button.textContent='大肥鱼的生活';
  document.querySelector('#more').before(button);
  const panel=document.createElement('dialog');panel.className='life-panel';
  panel.innerHTML='<div class="bar"><h2>大肥鱼的生活</h2><button data-close>关闭</button></div>'+
    '<p class="life-intro">慢慢活动，安静陪伴。接到文件时，会先把你的事情做好。</p>'+
    '<div class="life-options"><label><input type="checkbox" data-enabled> 自主生活</label>'+
    '<label><input type="checkbox" data-quiet> 安静陪伴</label><label><input type="checkbox" data-ai> DeepSeek 规划</label></div>'+
    '<small>安静陪伴会暂停散步、玩耍等自主活动，仍然可以聊天和投喂。</small>'+
    '<div data-state role="status"></div><div data-planner></div><button data-replan>重新规划</button><h3>最近的小经历</h3><ol data-history></ol>'+
    '<small>规划只发送简要状态与近期小经历，通过 dsh 已配置的 DeepSeek 调用。文件正文和其它应用内容不进入生活规划。</small>';
  document.body.append(panel);
  let timer,loading=false,pendingPatch=null;
  const enabled=panel.querySelector('[data-enabled]'),quiet=panel.querySelector('[data-quiet]'),ai=panel.querySelector('[data-ai]');
  async function render(patch) {
    if(loading){if(patch)pendingPatch={...pendingPatch,...patch};return;} loading=true;
    try {
      const status=await library.life(patch);if(!status)return;
      enabled.checked=status.enabled;quiet.checked=status.quiet;quiet.disabled=!status.enabled;
      ai.checked=status.ai!==false;ai.disabled=!status.enabled;
      const body=panel.querySelector('[data-state]'),history=panel.querySelector('[data-history]');
      const planning=panel.querySelector('[data-planner]');planning.replaceChildren();
      panel.querySelector('[data-replan]').disabled=!status.enabled || status.quiet || status.ai===false;
      body.replaceChildren();history.replaceChildren();
      if(!status.pets.length)body.textContent='等待桌宠就绪…';
      for(const pet of status.pets) {
        const row=document.createElement('p');row.textContent=!status.enabled?'自主生活已暂停':pet.reason;
        const detail=document.createElement('small');
        detail.textContent=`精力${pet.energy>65?'充足':pet.energy>35?'平稳':'偏低'} · ${pet.sleepiness>60?'有点困':'精神还不错'}${pet.home?' · 已记住你放我的位置':''}`;
        body.append(row,detail);
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
})();
