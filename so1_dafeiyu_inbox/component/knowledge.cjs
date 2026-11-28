const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const ignored=new Set(['什么','怎么','如何','告诉','诉我','帮我','一下','哪些','有哪','我想','想问','请问','关于','根据',
  '知识','识库','资料','手册','查查','看看','大肥','肥鱼','双旋','旋翼','旋飞','以及','需要','的方','方法']);
function tokens(text){
  const normalized=String(text).normalize('NFKC').toLowerCase()
    .replace(/叫什么|是什么|什么是|怎么样|怎么|如何|有哪些|是什么样|你知道|帮我|请问|告诉我/gu,' ');
  const words=normalized.match(/[\u3400-\u9fff]+|[a-z0-9_]+/gu)||[];
  return [...new Set(words.flatMap(word=>/[\u3400-\u9fff]/u.test(word)?
    Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)):[word])
    .filter(word=>word.length>=2 && !ignored.has(word)))].slice(0,36);
}

module.exports=function knowledgeIndex(data){
  const file=path.join(data,'knowledge.sqlite');
  let cached;
  let cachedOwner;
  let cachedOutline;
  function read(query,fallback){
    if(!fs.existsSync(file))return fallback;
    let db;
    try{db=new DatabaseSync(file,{readOnly:true});return query(db);}
    catch(error){console.warn('[fish-knowledge] 读取知识索引失败',error.code);return fallback;}
    finally{db?.close();}
  }
  function libraries(){
    const stat=fs.statSync(file,{throwIfNoEntry:false});
    if(!stat)return [];
    const revision=`${stat.mtimeMs}:${stat.size}`;
    if(cached?.revision===revision)return cached.rows;
    const rows=read(db=>db.prepare('SELECT id,label,version,documents,passages FROM libraries ORDER BY rowid')
      .all().map(row=>({...row,documents:JSON.parse(row.documents)})),[]);
    if(rows.length)cached={revision,rows};
    return rows;
  }
  function owner(){
    const stat=fs.statSync(file,{throwIfNoEntry:false});
    if(!stat)return null;
    const revision=`${stat.mtimeMs}:${stat.size}`;
    if(cachedOwner?.revision===revision)return cachedOwner.profile;
    const profile=read(db=>{
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='owner_profile'").get())return null;
      const row=db.prepare("SELECT facts FROM owner_profile WHERE id='so1-kb'").get();
      return row?JSON.parse(row.facts):null;
    },null);
    cachedOwner={revision,profile};
    return profile;
  }
  function outline(){
    const list=libraries();
    if(!list.length)return [];
    if(cachedOutline?.revision===cached.revision)return cachedOutline.rows;
    const sections=new Map();
    for(const row of read(db=>db.prepare(`SELECT domain,document,title,count(*) AS passages FROM passages
      GROUP BY domain,document,title ORDER BY min(rowid)`).all(),[])){
      if(!sections.has(row.domain))sections.set(row.domain,new Map());
      const documents=sections.get(row.domain);
      if(!documents.has(row.document))documents.set(row.document,[]);
      documents.get(row.document).push({title:row.title,passages:row.passages});
    }
    const rows=list.map(library=>({...library,sections:Object.fromEntries(sections.get(library.id)||[])}));
    cachedOutline={revision:cached.revision,rows};
    return rows;
  }
  function search(question,scope='general'){
    const project=/双旋翼|倾转|bicopter|ardupilot|betaflight|飞控|混控|试飞|舵机|共轴|横滚|俯仰|首飞|首悬|pid/iu.test(question);
    const desktop=/dsh[- ]?pet|deepseek harness|大肥鱼|桌宠|桌面宠物|cordis|webm|记忆舱|星图|动作素材/iu.test(question.replace(/^大肥鱼[，,、：:\s]+/u,''));
    const upstream=/上游|源码|cordis|api\b|\bsrc\b/iu.test(question);
    const query=scope==='owner'?question.replace(/守一(?:工作室)?|\bso1\b|我的|我以前|知识库|参考资料/giu,' ')
      .replace(/\bB站|哔哩哔哩/giu,' bilibili 账号 '):question.replace(/大肥鱼|双旋翼|知识库|参考资料/gu,' ');
    const definition=project && /(?:双旋翼|bicopter)(?:是什么|什么意思)|什么是(?:双旋翼|bicopter)/iu.test(question);
    const words=definition && scope!=='owner'?['构型']:tokens(query).filter(word=>word!=='是什' && word!=='么是');
    if(!words.length)return [];
    let domain='all';
    if(project && !desktop)domain='bicopter';
    if(desktop && !project)domain='desktop';
    const expression=words.map(word=>'"'+word+'"').join(' OR ');
    return read(db=>{
      const rows=db.prepare(`SELECT p.domain,p.document,p.title,p.text,l.label,l.version,bm25(search,6.0,1.0) AS score
        FROM search JOIN passages p ON p.rowid=search.rowid JOIN libraries l ON l.id=p.domain
        WHERE search MATCH ? AND (?='owner')=(p.domain='so1-kb')
          AND (?='owner' OR ?='all' OR (?='bicopter')=(p.domain='bicopter-kb'))
        ORDER BY score LIMIT 32`).all(expression,scope,scope,domain,domain);
      const ranked=rows.map(row=>{
        const title=new Set(tokens(row.title)),body=new Set(tokens(row.text));
        const hits=words.filter(word=>title.has(word)||body.has(word));
        const bonus=upstream && row.domain==='dsh-pet-main'?1.18:1;
        return {row,hits:hits.length,rank:(-row.score+hits.length*.32)*bonus};
      }).filter(row=>row.hits>=(scope==='owner'?1:Math.min(words.length,2))).sort((a,b)=>b.rank-a.rank);
      if(!ranked.length)return [];
      const sections=new Set(),counts=new Map(),results=[];
      for(const {row,rank} of ranked){
        if(rank<ranked[0].rank*.36)continue;
        const document=row.domain+'/'+row.document;
        const key=document+'#'+row.title;
        const seen=counts.get(document)||0;
        if(sections.has(key)||seen>=2)continue;
        sections.add(key);counts.set(document,seen+1);
        const {label,version,title,text}=row;
        results.push({label,version,document:row.document,title,text:text.slice(0,1100)});
        if(results.length===4)break;
      }
      return results;
    },[]);
  }
  return {libraries,outline,search,owner};
};
