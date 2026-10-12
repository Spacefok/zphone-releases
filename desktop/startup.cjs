const STARTUP_NAME='ZphoneTest';
const STARTUP_ARGS=[];
const path=require('node:path');

function elevatedStartup(executable){
  const literal="'"+executable.replaceAll("'","''")+"'";
  const script=`Start-Process -FilePath ${literal} -Verb RunAs -WindowStyle Hidden`;
  return {path:path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),args:['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]};
}

function createStartup({app,executable=process.execPath,storedPath,name=STARTUP_NAME,elevation=false,available=process.platform==='win32'&&app.isPackaged}) {
  let registeredPath=typeof storedPath==='string'&&storedPath?storedPath:executable;
  const read=()=>{
    if(!available)return {available:false,enabled:false};
    try{
      const launch=elevation?elevatedStartup(registeredPath):{path:registeredPath,args:STARTUP_ARGS};
      const find=target=>app.getLoginItemSettings(target).launchItems?.find(item=>item.name===name&&item.scope==='user'&&item.path.toLowerCase()===target.path.toLowerCase()&&JSON.stringify(item.args)===JSON.stringify(target.args));
      const item=find(launch),legacy=elevation&&!item?find({path:registeredPath,args:STARTUP_ARGS}):null;
      return {available:true,enabled:Boolean((item||legacy)?.enabled),registered:Boolean(item||legacy),legacy:Boolean(legacy?.enabled),otherVersion:Boolean(item||legacy)&&registeredPath.toLowerCase()!==executable.toLowerCase()};
    }catch{return {available:false,enabled:false};}
  };
  return {read,set(enabled){
    if(typeof enabled!=='boolean')throw Error('Некорректная настройка автозапуска.');
    if(!available)throw Error('Автозапуск доступен только в Windows-сборке.');
    const launch=elevation?elevatedStartup(executable):{path:executable,args:STARTUP_ARGS};
    app.setLoginItemSettings({name,...launch,openAtLogin:enabled,enabled});
    registeredPath=executable;
    const result=read();
    if(!result.available||result.enabled!==enabled||(!enabled&&result.registered))throw Error('Windows не подтвердила изменение автозапуска.');
    return result;
  }};
}

function shouldStartHidden(settings,trayAvailable){return settings.startInTray===true&&Boolean(trayAvailable);}
module.exports={createStartup,shouldStartHidden,elevatedStartup,STARTUP_NAME,STARTUP_ARGS};
