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
  function record(kind, text, now) {
    state.history.push({kind, text, at: now}); state.history = state.history.slice(-40);
  }
  function select(id, why, seconds, now) {
    activity = id; reason = why; until = now + seconds * 1000;
    if (id !== 'quiet') { lastSpecial = now; cooldown[id] = now; last = id; record('activity', why, now); }
  }
  return {
    state,
    interrupt(now, why = '正在回应你') { select('quiet', why, 25, now); },
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
      if (blocked) {
        select('quiet', env.busy ? '先把你的事情做好' : '正在回应你', 25, now);
      } else if (env.suspended || env.fullscreen || env.quietMode) {
        select('quiet', env.suspended ? '暂时休息' : '安静陪着你', 20, now);
      } else if (activity === 'nap' && env.idle < 20) {
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
        if (now-lastSpecial < 90000 || !candidates.length) select('quiet', '安静陪着你', 25, now);
        else {
          let roll = random()*candidates.reduce((sum,c) => sum+c[3],0);
          const chosen = candidates.find(c => (roll -= c[3]) < 0) || candidates[candidates.length-1];
          select(chosen[0], chosen[1], chosen[2], now);
        }
      }
      return {activity, reason, until, state};
    },
  };
};
