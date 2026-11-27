const {DatabaseSync}=require('node:sqlite');
const {randomUUID,randomBytes}=require('node:crypto');
const path=require('node:path');

const labels={work_move:'工作时少走动',quiet_hours:'安静时段',disdain:'「一脸嫌弃」频率',persona:'性格设定',note:'沟通重点'};
const clean=(text,max=180)=>typeof text==='string'?text.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';
const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
function normalize(key,value){
  if(key==='work_move' && typeof value==='boolean')return value;
  if(key==='quiet_hours' && clock.test(value?.start) && clock.test(value?.end) && value.start!==value.end)
    return {start:value.start,end:value.end};
  if(key==='disdain' && ['often','less','off'].includes(value))return value;
  if(key==='persona' && ['curious','calm','playful'].includes(value))return value;
  if(key==='note' && clean(value))return clean(value);
  throw Error('记忆内容不符合支持的偏好');
}
function describe(row){
  if(row.key==='work_move')return row.value?'工作时留在原地':'工作时允许走动';
  if(row.key==='quiet_hours')return row.value.start+'–'+row.value.end+' 少说话';
  if(row.key==='disdain')return {often:'正常使用嫌弃脸',less:'少用嫌弃脸',off:'桌面观察停用嫌弃脸'}[row.value];
  if(row.key==='persona')return {curious:'好奇，喜欢观察',calm:'安静，偏向陪伴',playful:'活泼，喜欢玩耍'}[row.value];
  return row.value;
}

module.exports=function openPetMemory(data,now=Date.now){
  const db=new DatabaseSync(path.join(data,'memory.sqlite'));
  if(db.prepare('PRAGMA user_version').get().user_version>1){
    db.close();throw Error('记忆库需要新版组件');
  }
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=1500;
    PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, pet TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      status TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL,
      recorded_at INTEGER NOT NULL, valid_from INTEGER, valid_to INTEGER, supersedes TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_pet_status ON memories(pet,status,valid_from);
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY, pet TEXT NOT NULL, episode TEXT NOT NULL, at INTEGER NOT NULL,
      action TEXT NOT NULL, evidence TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS decision_pet_time ON decisions(pet,at);
    CREATE TABLE IF NOT EXISTS memory_receipts (id TEXT PRIMARY KEY, pet TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA user_version=1;
  `);
  db.prepare("INSERT OR IGNORE INTO memory_meta VALUES('bridge',?)").run(randomBytes(24).toString('hex'));
  const bridgeKey=db.prepare("SELECT value FROM memory_meta WHERE key='bridge'").get().value;
  const active=new Map();
  const decode=row=>({...row,value:JSON.parse(row.value)});
  function activeRows(pet){
    if(!active.has(pet))active.set(pet,db.prepare(
      "SELECT * FROM memories WHERE pet=? AND status='active' ORDER BY valid_from DESC").all(pet).map(decode));
    return active.get(pet);
  }
  function insert(pet,key,value,{source='panel',evidence='',suggestion=false,requestId}={}){
    value=normalize(key,value);
    const at=now(),id=randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try{
      if(requestId && !db.prepare('INSERT OR IGNORE INTO memory_receipts VALUES(?,?,?)').run(requestId,pet,at).changes){
        db.exec('COMMIT');return null;
      }
      const old=key==='note'
        ? db.prepare("SELECT id FROM memories WHERE pet=? AND key=? AND value=? AND status=?").get(pet,key,JSON.stringify(value),suggestion?'suggested':'active')
        : db.prepare("SELECT id FROM memories WHERE pet=? AND key=? AND status='active'").get(pet,key);
      if(old && key==='note'){db.exec('COMMIT');return old.id;}
      if(old && !suggestion)db.prepare("UPDATE memories SET status='superseded',valid_to=? WHERE id=?").run(at,old.id);
      db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,pet,key,JSON.stringify(value),
        suggestion?'suggested':'active',source,clean(evidence),at,suggestion?null:at,null,old?.id||null);
      db.exec('COMMIT');active.delete(pet);return id;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function confirm(pet,id){
    const row=db.prepare("SELECT id FROM memories WHERE pet=? AND id=? AND status='suggested' AND key='note'").get(pet,id);
    if(!row)return false;
    const ok=!!db.prepare("UPDATE memories SET status='active',valid_from=? WHERE pet=? AND id=?").run(now(),pet,id).changes;
    active.delete(pet);return ok;
  }
  function forget(pet,id){
    const row=db.prepare('SELECT key,status FROM memories WHERE pet=? AND id=?').get(pet,id);
    if(!row)return false;
    // Forgetting the current preference also removes its superseded values, so it cannot reappear in recall.
    if(row.status==='active' && row.key!=='note')db.prepare('DELETE FROM memories WHERE pet=? AND key=?').run(pet,row.key);
    else db.prepare('DELETE FROM memories WHERE pet=? AND id=?').run(pet,id);
    active.delete(pet);return true;
  }
  function policy(pet,{working=false,at=now()}={}){
    const rules=Object.fromEntries(activeRows(pet).filter(row=>row.key!=='note').map(row=>[row.key,row]));
    const hours=rules.quiet_hours;
    const time=new Date(at),local=String(time.getHours()).padStart(2,'0')+':'+String(time.getMinutes()).padStart(2,'0');
    const quiet=hours && (hours.value.start<hours.value.end ? hours.value.start<=local && local<hours.value.end :
      hours.value.start<=local || local<hours.value.end);
    return {
      stationary:working && rules.work_move?.value===true?rules.work_move.id:null,
      quiet:quiet?hours.id:null,
      disdain:rules.disdain?{id:rules.disdain.id,mode:rules.disdain.value}:null,
      persona:rules.persona?.value || 'curious'
    };
  }
  function decide(pet,episode,action,ids){
    db.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?)').run(randomUUID(),pet,episode,now(),action,
      JSON.stringify([...new Set(ids.filter(Boolean))]));
    db.prepare('DELETE FROM decisions WHERE pet=? AND at<?').run(pet,now()-30*86400000);
  }
  function snapshot(pet,episodeIds=[]){
    const rows=db.prepare('SELECT * FROM memories WHERE pet=? ORDER BY recorded_at DESC,rowid DESC LIMIT 150').all(pet)
      .map(decode).map(row=>({...row,label:labels[row.key],summary:describe(row)}));
    const decisions=db.prepare('SELECT * FROM decisions WHERE pet=? ORDER BY at DESC LIMIT 450').all(pet)
      .filter(row=>episodeIds.includes(row.episode)).map(row=>({...row,evidence:JSON.parse(row.evidence)}));
    return {memories:rows,decisions};
  }
  function chatContext(pet){
    return activeRows(pet).slice(0,40).map(row=>({text:describe(row),kind:row.key,at:row.valid_from}));
  }
  return {insert,confirm,forget,policy,decide,snapshot,chatContext,bridgeKey,close:()=>db.close()};
};
