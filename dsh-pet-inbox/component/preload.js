const {ipcRenderer, webUtils} = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  const note=document.querySelector('#note');
  ipcRenderer.on('inbox:status',(_,msg)=>{note.textContent=msg;note.title=msg;});
  for(const event of ['dragenter','dragover']) window.addEventListener(event,e=>{
    e.preventDefault();e.dataTransfer.dropEffect='copy';document.body.classList.add('over');
  });
  window.addEventListener('dragleave',e=>{if(!e.relatedTarget) document.body.classList.remove('over');});
  window.addEventListener('drop',e=>{
    e.preventDefault();document.body.classList.remove('over');
    const paths=Array.from(e.dataTransfer.files,f=>webUtils.getPathForFile(f)).filter(Boolean);
    if(paths.length) ipcRenderer.send('inbox:drop',paths);
  });
  document.querySelector('main').ondblclick=()=>ipcRenderer.send('inbox:open');
  document.querySelector('button').onclick=()=>ipcRenderer.send('inbox:menu');
  window.oncontextmenu=e=>{e.preventDefault();ipcRenderer.send('inbox:menu');};
  window.onkeydown=e=>{if(e.key==='Enter' && e.target.tagName!=='BUTTON') ipcRenderer.send('inbox:open');};
});
