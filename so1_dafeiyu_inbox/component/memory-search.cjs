// SQLite remains the source of truth. Rank the current pet's records before cutting the result list.
const normalize=value=>String(value || '').normalize('NFKC').toLowerCase();
function terms(question){
  const query=normalize(question).replace(/大肥鱼|上周|本周|这周|昨天|今天|现在|刚才|之前|帮我|找一下|查一下|你记得|还记得|有没有|哪个文件夹|放在哪|在哪里|在哪儿|在哪|仓库里|仓库|什么地方|收进去的?|的文件/gu,' ');
  return [...new Set((query.match(/[\u3400-\u9fff]+|[a-z0-9]+/giu) || []).flatMap(word=>{
    if(/[\u3400-\u9fff]/u.test(word))
      return Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2));
    return word.length>1?[word]:[];
  }).filter(word=>!['文件','位置','找到','一下','记得','收进'].includes(word)))].slice(0,60);
}
function rank(rows,question,fields,limit){
  const keys=terms(question);
  return rows.map(row=>({row,score:fields(row).reduce((sum,[value,weight])=>{
    const text=normalize(value);
    return sum+keys.filter(key=>text.includes(key)).length*weight;
  },0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.row);
}
function warehouseSearch(rows,question,now=new Date()){
  const window=question.match(/上周|本周|这周|昨天|今天/u)?.[0];
  if(window){
    const start=new Date(now),end=new Date(now);
    start.setHours(0,0,0,0);
    if(window==='昨天')start.setDate(start.getDate()-1);
    if(['上周','本周','这周'].includes(window)){
      start.setDate(start.getDate()-(start.getDay()+6)%7-(window==='上周'?7:0));
      end.setTime(start.getTime());end.setDate(end.getDate()+7);
    }else{end.setTime(start.getTime());end.setDate(end.getDate()+1);}
    rows=rows.filter(row=>{
      const time=new Date(String(row.added || '').replace(' ','T'));
      return time>=start && time<end;
    });
  }
  return rank(rows,question,row=>[[row.name,5],[row.folder,2],[row.format,1]],5)
    .map(({name,path,added})=>({name,path,added}));
}
module.exports={rank,warehouseSearch,terms};
