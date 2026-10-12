const STARTUP_NAME='ZphoneTest';
const STARTUP_ARGS=[];

function createStartup({app,executable=process.execPath,storedPath,name=STARTUP_NAME,available=process.platform==='win32'&&app.isPackaged}) {
  let registeredPath=typeof storedPath==='string'&&storedPath?storedPath:executable;
  const read=()=>{
    if(!available)return {available:false,enabled:false};
    try{
      const result=app.getLoginItemSettings({path:registeredPath,args:STARTUP_ARGS});
      const item=result.launchItems?.find(item=>item.name===name&&item.scope==='user'&&item.path.toLowerCase()===registeredPath.toLowerCase()&&JSON.stringify(item.args)===JSON.stringify(STARTUP_ARGS));
      return {available:true,enabled:Boolean(item?.enabled),registered:Boolean(item),otherVersion:Boolean(item)&&registeredPath.toLowerCase()!==executable.toLowerCase()};
    }catch{return {available:false,enabled:false};}
  };
  return {read,set(enabled){
    if(typeof enabled!=='boolean')throw Error('Некорректная настройка автозапуска.');
    if(!available)throw Error('Автозапуск доступен только в Windows-сборке.');
    app.setLoginItemSettings({name,path:executable,args:STARTUP_ARGS,openAtLogin:enabled,enabled});
    registeredPath=executable;
    const result=read();
    if(!result.available||result.enabled!==enabled||(!enabled&&result.registered))throw Error('Windows не подтвердила изменение автозапуска.');
    return result;
  }};
}

function shouldStartHidden(settings,trayAvailable){return settings.startInTray===true&&Boolean(trayAvailable);}
module.exports={createStartup,shouldStartHidden,STARTUP_NAME,STARTUP_ARGS};
