// 生活信息放在独立面板，文件管理仍是双击后的主页。
(() => {
  const button=document.createElement('button');button.textContent='大肥鱼的生活';
  document.querySelector('#more').before(button);
  const panel=document.createElement('dialog');panel.className='life-panel';
  panel.innerHTML='<div class="bar"><h2>大肥鱼的生活</h2><button data-close>关闭</button></div>'+
    '<p class="life-intro">慢慢活动，安静陪伴。接到文件时，会先把你的事情做好。</p>'+
    '<div class="life-options"><label><input type="checkbox" data-enabled> 自主生活</label>'+
    '<label><input type="checkbox" data-quiet> 安静陪伴</label></div>'+
    '<small>安静陪伴会暂停散步、玩耍等自主活动，仍然可以聊天和投喂。</small>'+
    '<div data-state role="status"></div><h3>最近的小经历</h3><ol data-history></ol>'+
    '<small>第一版在本地感知时间、空闲和窗口几何，不读取其它应用正文，不调用模型。</small>';
  document.body.append(panel);
  let timer,loading=false,pendingPatch=null;
  const enabled=panel.querySelector('[data-enabled]'),quiet=panel.querySelector('[data-quiet]');
  async function render(patch) {
    if(loading){if(patch)pendingPatch={...pendingPatch,...patch};return;} loading=true;
    try {
      const status=await library.life(patch);if(!status)return;
      enabled.checked=status.enabled;quiet.checked=status.quiet;quiet.disabled=!status.enabled;
      const body=panel.querySelector('[data-state]'),history=panel.querySelector('[data-history]');
      body.replaceChildren();history.replaceChildren();
      if(!status.pets.length)body.textContent='等待桌宠就绪…';
      for(const pet of status.pets) {
        const row=document.createElement('p');row.textContent=!status.enabled?'自主生活已暂停':pet.reason;
        const detail=document.createElement('small');
        detail.textContent=`精力${pet.energy>65?'充足':pet.energy>35?'平稳':'偏低'} · ${pet.sleepiness>60?'有点困':'精神还不错'}${pet.home?' · 已记住你放我的位置':''}`;
        body.append(row,detail);
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
})();
