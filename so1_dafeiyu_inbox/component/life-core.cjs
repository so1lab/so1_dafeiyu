// 纯行为模型：不访问窗口、文件或模型接口，便于用虚拟时间验证长时间运行。
module.exports = function createLife(saved = {}, random = Math.random) {
  const clamp = x => Math.max(0, Math.min(100, x));
  const number = (x, fallback) => Number.isFinite(x) ? x : fallback;
  const state = {
    version: 1, energy: clamp(number(saved.energy, 78)),
    sleepiness: clamp(number(saved.sleepiness, 12)), mood: clamp(number(saved.mood, 65)),
    curiosity: clamp(number(saved.curiosity, 35)), updatedAt: number(saved.updatedAt, 0),
    home: saved.home && [saved.home.rx, saved.home.ry].every(Number.isFinite) ? saved.home : null,
    history: Array.isArray(saved.history) ? saved.history.slice(-40) : [],
  };
  let activity = 'quiet', until = 0, lastSpecial = -Infinity, last = '', reason = '安静陪着你';
  const cooldown = {};
  let pendingPlan=null, revision=0, source='local', blockedBefore=false;
  const eligible=env=>['quiet',...(env.available || []).filter(id=>
    !['quiet','stroll','play','nap'].includes(id) ||
    (id==='stroll' && env.idle>=90 && env.canStroll) || (id==='play' && env.idle>=120) || (id==='nap' && env.idle>=300))];
  function cancelPlan(){pendingPlan=null;revision++;}
  function record(kind, text, now) {
    state.history.push({kind, text, at: now}); state.history = state.history.slice(-40);
  }
  function select(id, why, seconds, now, by='local') {
    activity = id; reason = why; until = now + seconds * 1000;source=by;
    if (id !== 'quiet') { lastSpecial = now; cooldown[id] = now; last = id; record('intent', '打算：'+why, now); }
  }
  return {
    state,
    resume(id,now){if(!['observe','stretch','play','rest'].includes(id))return false;cancelPlan();select(id,'你让我继续刚才的小活动',id==='rest'?70:12,now);return true;},
    cancelPlan,
    offerPlan(plan,now,expectedRevision) {
      if(expectedRevision!==revision || !plan || plan.expiresAt<=now || !Array.isArray(plan.steps) || !plan.steps.length)return false;
      pendingPlan={...plan,steps:plan.steps.map(s=>({...s}))};return true;
    },
    interrupt(now, why = '正在回应你') { cancelPlan();select('quiet', why, 25, now); },
    complete(now) { state.mood = clamp(state.mood + 3); record('task', '刚刚处理完一项任务', now); },
    rememberHome(home, now) { state.home = home; record('place', '记住了你放我的位置', now); },
    tick(env) {
      const now = env.now, elapsed = state.updatedAt ? Math.max(0, (now - state.updatedAt) / 1000) : 0;
      // 挂起/离线只估算休息恢复，不补播活动、不虚构任务。
      const away = elapsed > 30 || env.suspended;
      const dt = Math.min(elapsed, 8 * 3600);
      const resting = away || activity === 'nap' || activity === 'rest';
      state.energy = clamp(state.energy + dt * (resting ? .018 : -.003));
      state.sleepiness = clamp(state.sleepiness + dt * (resting ? -.025 : .004));
      state.curiosity = clamp(state.curiosity + Math.min(dt, 30) * (activity === 'observe' ? -.15 : .015));
      state.updatedAt = now;
      if (away) select('quiet', '休息过了，慢慢醒来', 35, now);
      const blocked = env.busy || env.interacting || env.external;
      const protectedNow=blocked || away || env.fullscreen || env.quietMode || env.suspended;
      if((protectedNow && !blockedBefore) || (env.aiEnabled===false && pendingPlan))cancelPlan();
      blockedBefore=!!protectedNow;
      if(pendingPlan && pendingPlan.expiresAt<=now)cancelPlan();
      if(pendingPlan && !pendingPlan.steps.length && now>=until)pendingPlan=null;
      if (blocked) {
        select('quiet', env.busy ? '先把你的事情做好' : '正在回应你', 25, now);
      } else if (env.suspended || env.fullscreen || env.quietMode) {
        select('quiet', env.suspended ? '暂时休息' : '安静陪着你', 20, now);
      } else if (activity === 'nap' && env.idle < 20) {
        cancelPlan();
        select('quiet', '你回来啦，慢慢醒来', 45, now);
      } else if (!until) {
        select('quiet', reason, 35 + random() * 25, now);
      } else if (now >= until) {
        const night = env.hour >= 23 || env.hour < 7;
        const candidates = [
          ['observe', '看看周围有什么变化', 8, 20 + state.curiosity, 150],
          ['stretch', '舒展一下，继续陪你', 10, 25 + (100-state.energy)*.4, 240],
          ['play', '你暂时没操作，我自己玩一小会儿', 14, env.idle >= 120 ? 65 : 0, 300],
          ['stroll', '去旁边慢慢溜达一下', 12, env.idle >= 90 && env.canStroll ? 60 : 0, 300],
          ['rest', '忙了一阵，原地歇一会儿', 70, state.energy < 65 ? 90 : 15, 180],
          ['nap', '这里很安静，打个盹', 180, env.idle >= 300 ? 60 + state.sleepiness + (night?30:0) : 0, 600],
        ].filter(([id,,,weight,cd]) => weight > 0 && env.available?.includes(id) &&
          id !== last && now - (cooldown[id] ?? -Infinity) >= cd*1000);
        let proposed=pendingPlan?.steps[0];
        // 同一份实时约束同时检查模型计划和本地选择，计划不能越过冷却或用户状态。
        if(proposed && (!eligible(env).includes(proposed.activity) ||
          (proposed.activity!=='quiet' && (now-lastSpecial<90000 || !candidates.some(c=>c[0]===proposed.activity))))) {
          cancelPlan();proposed=null;
        }
        if(proposed) {
          pendingPlan.steps.shift();select(proposed.activity,proposed.reason,proposed.durationSec,now,'deepseek');
        } else if (now-lastSpecial < 90000 || !candidates.length) select('quiet', '安静陪着你', 25, now);
        else {
          let roll = random()*candidates.reduce((sum,c) => sum+c[3],0);
          const chosen = candidates.find(c => (roll -= c[3]) < 0) || candidates[candidates.length-1];
          select(chosen[0], chosen[1], chosen[2], now);
        }
      }
      if(pendingPlan && !pendingPlan.steps.length && now>=until)pendingPlan=null;
      return {activity, reason, until, state,source,planning:{revision,eligible:eligible(env),
        ready:!protectedNow,remaining:pendingPlan?pendingPlan.steps.length+(source==='deepseek'?1:0):0,
        goal:pendingPlan?.goal || '',model:pendingPlan?.model || ''}};
    },
  };
};
