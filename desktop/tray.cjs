function createTray({Tray,Menu,nativeImage,window,iconPath,getState,isQuitting,disconnect,quit,logger}) {
  const image=nativeImage.createFromPath(iconPath);
  if(image.isEmpty())throw Error('Tray icon unavailable');
  const tray=new Tray(image);let disposed=false,stopping=false,lastMenu='';
  const show=()=>{if(disposed||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();logger?.write('window.shown');};
  const update=()=>{
    if(disposed)return;
    const state=getState(),status=state.status||'off';
    const labels={off:'Не подключено',connecting:'Подключаемся',checking:'Проверяем интернет',recovering:'Восстанавливаем соединение',connected:state.mode==='isolated'?'Прокси подключён':'Подключено',disconnecting:'Отключаемся',error:'Ошибка подключения'};
    const route=state.route?`${state.route.location} · ${state.route.protocol}`:'';
    const title=[labels[status]||labels.off,route].filter(Boolean).join(' · ');
    const key=title+stopping;if(key===lastMenu)return;lastMenu=key;
    const canStop=['connecting','checking','recovering','connected'].includes(status)&&!stopping;
    tray.setToolTip('Zphone · '+title);
    tray.setContextMenu(Menu.buildFromTemplate([
      {id:'status',label:title,enabled:false},{type:'separator'},
      {id:'open',label:'Открыть Zphone',click:show},
      {id:'disconnect',label:status==='connected'?'Отключить':'Отменить подключение',enabled:canStop,click:async()=>{
        if(stopping)return;stopping=true;update();logger?.write('tray.disconnect');
        try{await disconnect();}catch(error){logger?.write('tray.command_error',{error});show();}finally{stopping=false;update();}
      }},
      {type:'separator'},{id:'quit',label:'Выход',click:()=>{logger?.write('tray.quit');quit();}},
    ]));
  };
  const hide=event=>{if(disposed||isQuitting())return;event.preventDefault();window.hide();logger?.write('window.hidden',{destination:'tray'});};
  tray.on('click',show);tray.on('double-click',show);window.on('minimize',hide);window.on('close',hide);
  try{update();logger?.write('tray.ready');}
  catch(error){disposed=true;window.removeListener('minimize',hide);window.removeListener('close',hide);tray.destroy();throw error;}
  return {update,show,dispose(){if(disposed)return;disposed=true;window.removeListener('minimize',hide);window.removeListener('close',hide);tray.destroy();}};
}
module.exports={createTray};
