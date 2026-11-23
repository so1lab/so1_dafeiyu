'use strict';

// 此函数在桌宠渲染进程执行，不能引用本模块作用域中的变量。
// 使用视频播放时间定位施法帧，加载慢时不会提前打开/关闭窗口。
function magicPhase(action, phase) {
  const s = sprites[0];
  if (!s || s.dragState.active) throw Error('桌宠正在拖动');
  if (phase === 'cue') {
    s.stopMove();
    s.stopThrow();
    const video = s.front === 0 ? s.videoB : s.videoA;
    s.playOnce(action.clip);
    // 收势后停在最后一帧，由送件流程决定下个动作，禁止随机动作抢占。
    video.onended = () => {};
    s.inboxMagic = { video, token: s.moveToken, gen: s.gen };
  }
  const state = s.inboxMagic;
  if (!state) throw Error('施法状态已失效');
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + action.timeoutMs;
    function tick() {
      if (s.inboxMagic !== state || s.dragState.active || s.moveToken !== state.token ||
          s.anim !== action.clip || s.gen !== state.gen) {
        return reject(Error('施法被打断'));
      }
      const video = state.video;
      if (video.error || performance.now() > deadline) return reject(Error('施法素材播放超时'));
      if (video.classList.contains('is-front') && video.readyState >= 2) {
        // 本素材原始方向朝右，上游 facing=right 默认镜像，需单独校正。
        video.style.transform = s.facing === 'right' ? '' : 'scaleX(-1)';
        if (phase === 'cue' && video.currentTime * 1000 >= action.releaseMs) return resolve();
        if (phase === 'end' && video.ended) {
          delete s.inboxMagic;
          return resolve();
        }
      }
      setTimeout(tick, 20);
    }
    tick();
  });
}

const evaluate = (pet, action, phase) => pet.webContents.executeJavaScript(
  '(' + magicPhase.toString() + ')(' + JSON.stringify(action) + ',' + JSON.stringify(phase) + ')'
);

module.exports = async function cast(pet, action, operation) {
  try {
  await evaluate(pet, action, 'cue');
  // 只在释放帧调用一次操作。操作与剩余收势并行，二者都完成才可出发。
  const results = await Promise.allSettled([
    Promise.resolve().then(operation),
    evaluate(pet, action, 'end'),
  ]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return results[0].value;
  } catch (error) {
    // 播放失败时离开冻结的末帧；拖拽/显式动作抢占时不夺回控制。
    if (!/打断|正在拖动/.test(error.message) && !pet.isDestroyed?.()) {
      await pet.webContents.executeJavaScript('('+function(clip){
        const s=sprites[0];
        if(s && s.anim===clip && !s.dragState.active){
          delete s.inboxMagic;
          s.stopMove();s.stopThrow();s.playOnce('待机呼吸休闲');
        }
      }.toString()+')('+JSON.stringify(action.clip)+')').catch(()=>{});
    }
    throw error;
  }
};
