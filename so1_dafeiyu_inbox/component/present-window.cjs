module.exports=function presentWindow(win){
  if(win.isMinimized())win.restore();
  if(!win.isVisible())win.show();
  // Raise it on Windows even when the OS leaves keyboard focus with another app.
  win.moveTop();
  win.focus();
};
