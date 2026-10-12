const {app,BrowserWindow,ipcMain,dialog,safeStorage,shell,session,powerMonitor,Tray,Menu,nativeImage}=require('electron');
const {createTray}=require('./tray.cjs');
const {createStartup,shouldStartHidden}=require('./startup.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
let window,engine,logger,networkTimer,updateTimer,trayController,bundle=null,settings={location:'auto',protocol:'auto',theme:'system',mode:'isolated',startInTray:false,autoCheckUpdates:true,autoDownloadUpdates:false,split:{mode:'all',apps:[]}},quitting=false,showRequested=false;
const root=path.resolve(__dirname,'..');
const build='windows-20261012.9';
if(!app.requestSingleInstanceLock()){app.quit();}
else {
app.setName('Zphone Test');
app.setPath('userData',path.join(app.getPath('appData'),'ZphoneTest'));
app.on('second-instance',()=>{showRequested=true;if(trayController)trayController.show();else{window?.show();window?.focus();}});
app.whenReady().then(async()=>{
  const {Engine}=await import('./engine.mjs');
  const {windowsNetworkStatus,windowsNetworkDiagnostics}=await import('./windows-network.mjs');
  const {Diagnostics}=await import('./diagnostics.mjs');
  const {diagnosticName,saveDiagnostics}=await import('./diagnostics-export.mjs');
  const {VERSION,PROTOCOLS,validateBundle,publicProfiles,compareVersion}=await import('../shared/profiles.mjs');
  const {validateSplit}=await import('../shared/split-tunnel.mjs');
  const {runningApplications,applicationItem}=await import('./windows-apps.mjs');
  const {Updates}=await import('./updates.mjs');
  const {Account}=await import('./account.mjs');
  const updateConfig=JSON.parse(await fs.readFile(path.join(root,'updates.json'),'utf8'));
  const storage=app.getPath('userData'),vault=path.join(storage,'access.enc');
  await fs.mkdir(storage,{recursive:true});
  logger=new Diagnostics(path.join(storage,'logs'));
  logger.write('app.start',{version:VERSION,build,os:os.release(),arch:process.arch,electron:process.versions.electron,pid:process.pid,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});logger.flush();
  try{const saved=JSON.parse(await fs.readFile(path.join(storage,'settings.json'),'utf8'));settings={...settings,...saved,split:validateSplit(saved.split)};}catch{}
  settings.startInTray=settings.startInTray===true;
  const startup=createStartup({app,storedPath:settings.startupPath});
  try{if(safeStorage.isEncryptionAvailable())bundle=validateBundle(JSON.parse(safeStorage.decryptString(await fs.readFile(vault))));}catch(error){logger.write('access.load_failed',{code:error.code||'invalid_or_unreadable'});}
  if(bundle)logger.protectProfiles(bundle.profiles);
  logger.write('access.loaded',{count:bundle?.profiles.length||0,protocols:[...new Set(bundle?.profiles.map(p=>p.protocol)||[])]});logger.flush();
  let updates,account;
  const snapshot=()=>{const {startupPath,...publicSettings}=settings;return {version:VERSION,build,platform:'windows',settings:publicSettings,startup:startup.read(),updates:updates?.snapshot(),account:account?.snapshot(),profiles:publicProfiles(bundle),diagnostics:{available:logger.available,session:logger.session},connection:engine?.state||{status:'off'}};};
  const busy=()=>!['off','error'].includes(engine.state.status);
  let networkPending=null,lastStatus=null;
  const captureNetwork=(reason,afterPending=false)=>{
    if(networkPending)return afterPending?networkPending.then(()=>captureNetwork(reason)):networkPending;
    networkPending=windowsNetworkDiagnostics().then(data=>logger.write('network.snapshot',{reason,connectionStatus:engine?.state.status,...data})).catch(error=>logger.write('network.error',{reason,error})).finally(()=>{networkPending=null;logger.flush();});
    return networkPending;
  };
  const notify=()=>{
    trayController?.update();
    if(engine&&lastStatus!==engine.state.status){lastStatus=engine.state.status;void captureNetwork('state:'+lastStatus,['off','connected','error'].includes(lastStatus));}
    if(window&&!window.isDestroyed())window.webContents.send('zphone-state',snapshot());
  };
  const accountVault=path.join(storage,'account.enc');
  account=new Account({config:updateConfig.auth,
    readToken:async()=>{try{return safeStorage.decryptString(await fs.readFile(accountVault));}catch{return null;}},
    writeToken:async token=>{if(!token){await fs.rm(accountVault,{force:true});return;}if(!safeStorage.isEncryptionAvailable())throw Error('Защищённое хранилище недоступно.');await fs.writeFile(accountVault,safeStorage.encryptString(token));}
  });
  await account.restore();
  const installed=app.isPackaged&&await fs.access(path.join(process.resourcesPath,'app-update.yml')).then(()=>true,()=>false);
  updates=new Updates({config:updateConfig,version:VERSION,installed,logger,notify});
  const autoUpdate=async()=>{if(!settings.autoCheckUpdates||quitting)return;const result=await updates.check();if(result.state==='available'&&settings.autoDownloadUpdates)await updates.download();};
  updateTimer=setInterval(()=>void autoUpdate(),6*60*60*1000);updateTimer.unref();
  const initialCheck=setTimeout(()=>void autoUpdate(),25000);initialCheck.unref();
  const runtime=app.isPackaged?path.join(process.resourcesPath,'runtime'):path.join(root,'runtime','windows');
  const preflight=async mode=>{
    if(mode!=='vpn')return;
    const check=await windowsNetworkStatus();
    logger.write('connection.preflight',{admin:check.admin,conflicts:check.conflicts.map(a=>a.Name),routedInterfaces:check.routedInterfaces});
    if(check.conflicts.length)throw Object.assign(Error('Обнаружен другой VPN. Он не будет изменён. Отключите его самостоятельно перед повторным подключением.'),{code:'VPN_CONFLICT'});
    if(!check.admin)throw Object.assign(Error('Для VPN-режима запустите Zphone Test от имени администратора.'),{code:'ADMIN_REQUIRED'});
  };
  engine=new Engine({binary:path.join(runtime,'mihomo.exe'),directory:path.join(storage,'session'),onState:notify,logger,beforeReconnect:preflight});
  powerMonitor.on('resume',()=>{logger.write('system.resume');void engine.recover('system.resume');});
  void captureNetwork('app.start');
  networkTimer=setInterval(()=>{if(engine.active){void captureNetwork('interval');void engine.api('/connections',3000).then(data=>logger.write('traffic.totals',{uploadBytes:data.uploadTotal,downloadBytes:data.downloadTotal,connections:data.connections?.length})).catch(error=>logger.write('traffic.error',{error}));}},30000);
  networkTimer.unref();
  window=new BrowserWindow({width:960,height:810,minWidth:380,minHeight:620,title:'Zphone Test',backgroundColor:'#fafbf9',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.setMenuBarVisibility(false);
  window.on('focus',notify);
  try{trayController=createTray({Tray,Menu,nativeImage,window,iconPath:path.join(root,'dist','tray.png'),getState:()=>engine.state,isQuitting:()=>quitting,disconnect:async()=>{await engine.stop();await captureNetwork('tray.disconnect',true);},quit:()=>app.quit(),logger});}
  catch(error){logger.write('tray.unavailable',{error});}
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
  window.webContents.on('render-process-gone',(_,details)=>logger.write('renderer.exit',{reason:details.reason,exitCode:details.exitCode}));
  const entry=path.join(root,'dist','index.html');
  ipcMain.handle('zphone',async(event,command,data)=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('Invalid sender');
    try{
    if(command==='snapshot')return snapshot();
    if(command==='openSupport'){if(!/^\w{5,32}$/.test(updateConfig.auth?.botUsername||''))throw Error('Адрес поддержки ещё не настроен.');await shell.openExternal('https://t.me/'+updateConfig.auth.botUsername);return {ok:true};}
    if(command==='accountBegin'){const result=await account.begin();await shell.openExternal(result.url);notify();return snapshot();}
    if(command==='accountPoll'){await account.poll();notify();return snapshot();}
    if(command==='accountLogout'){await account.logout();notify();return snapshot();}
    if(command==='accountProfiles'){
      if(busy())throw Error('Сначала отключите тестовое соединение.');
      const response=await account.profiles();if(response.state!=='ready')throw Error('Доступ одобрен, подключения ещё готовятся.');
      const imported=validateBundle(response.bundle);
      if(!safeStorage.isEncryptionAvailable())throw Error('Защищённое хранилище недоступно.');
      await fs.writeFile(vault,safeStorage.encryptString(JSON.stringify(imported)));bundle=imported;logger.protectProfiles(bundle.profiles);logger.write('access.from_bot',{count:bundle.profiles.length});notify();return snapshot();
    }
    if(command==='exportDiagnostics'){
      const picked=await dialog.showSaveDialog(window,{title:'Экспорт диагностики',defaultPath:path.join(app.getPath('downloads'),diagnosticName()),filters:[{name:'ZIP',extensions:['zip']}]});
      if(picked.canceled||!picked.filePath)return {canceled:true};
      logger.write('user.export_diagnostics');
      return saveDiagnostics(logger,picked.filePath,{version:VERSION,build,platform:'windows',os:os.release(),arch:process.arch,connectionStatus:engine.state.status,location:settings.location,protocol:settings.protocol,mode:settings.mode,splitMode:settings.split.mode,splitAppCount:settings.split.apps.length,profileCount:bundle?.profiles.length||0});
    }
    if(command==='openLogs'){logger.write('user.open_logs');logger.flush();const error=await shell.openPath(logger.directory);if(error)throw Error('Не удалось открыть папку журналов.');return {ok:true};}
    if(command==='markIssue'){logger.write('user.mark',{connection:engine.state,selection:{location:settings.location,protocol:settings.protocol,mode:settings.mode}});await captureNetwork('user.mark',true);return {ok:logger.available};}
    if(command==='listApps')return {apps:await runningApplications()};
    if(command==='pickApp'){
      if(busy())throw Error('Сначала отключите тестовое соединение.');
      const picked=await dialog.showOpenDialog(window,{title:'Приложение для раздельного туннелирования',properties:['openFile'],filters:[{name:'Windows',extensions:['exe']}]});
      return {app:picked.canceled?null:applicationItem(picked.filePaths[0])};
    }
    if(command==='import'){
      if(busy())throw Error('Сначала отключите тестовое соединение.');
      const picked=await dialog.showOpenDialog(window,{title:'Тестовые доступы Zphone',properties:['openFile'],filters:[{name:'Zphone',extensions:['zphone','json']}]});
      if(picked.canceled)return snapshot();
      const stat=await fs.stat(picked.filePaths[0]);if(stat.size>131072)throw Error('Файл слишком большой.');
      const imported=validateBundle(JSON.parse(await fs.readFile(picked.filePaths[0],'utf8')));
      if(!safeStorage.isEncryptionAvailable())throw Error('Защищённое хранилище Windows недоступно.');
      await fs.writeFile(vault,safeStorage.encryptString(JSON.stringify(imported)));bundle=imported;logger.protectProfiles(bundle.profiles);logger.write('access.import',{count:bundle.profiles.length});notify();return snapshot();
    }
    if(command==='settings'){
      if(!data||typeof data!=='object')throw Error('Некорректные настройки.');
      for(const key of ['startWithWindows','startInTray','autoCheckUpdates','autoDownloadUpdates'])if(data[key]!==undefined&&typeof data[key]!=='boolean')throw Error('Некорректная настройка.');
      if(busy()&&['location','protocol','mode','split'].some(key=>data[key]!==undefined))throw Error('Сначала отключите тестовое соединение.');
      const split=data.split===undefined?settings.split:validateSplit(data.split);
      const next={...settings,split};
      if(data.location!==undefined&&['auto','FIN','AMS'].includes(data.location))next.location=data.location;
      if(data.protocol!==undefined&&['auto',...PROTOCOLS].includes(data.protocol))next.protocol=data.protocol;
      if(data.theme!==undefined&&['system','light','dark'].includes(data.theme))next.theme=data.theme;
      if(data.mode!==undefined&&['isolated','vpn'].includes(data.mode))next.mode=data.mode;
      if(data.startInTray!==undefined)next.startInTray=data.startInTray;
      for(const key of ['autoCheckUpdates','autoDownloadUpdates'])if(data[key]!==undefined)next[key]=data[key];
      if(data.startWithWindows!==undefined)next.startupPath=process.execPath;
      await fs.writeFile(path.join(storage,'settings.json'),JSON.stringify(next));
      try{if(data.startWithWindows!==undefined){startup.set(data.startWithWindows);logger.write('startup.changed',{enabled:data.startWithWindows});}}
      catch(error){await fs.writeFile(path.join(storage,'settings.json'),JSON.stringify(settings));throw error;}
      settings=next;const {startupPath,...loggedSettings}=settings;logger.write('settings.changed',{...loggedSettings,split:{mode:split.mode,count:split.apps.length}});notify();return snapshot();
    }
    if(command==='connect'){
      if(updates.state.state==='installing')throw Error('Дождитесь завершения установки обновления.');
      if(busy())return snapshot();
      logger.write('user.connect',{location:settings.location,protocol:settings.protocol,mode:settings.mode});
      await captureNetwork('before.connect',true);
      if(!bundle)throw Error('Сначала импортируйте тестовый доступ.');
      if(settings.mode==='vpn'&&settings.split.mode==='include'&&!settings.split.apps.length)throw Error('Выберите хотя бы одно приложение для VPN.');
      await preflight(settings.mode);
      engine.start(bundle.profiles,{...settings},settings.mode);return snapshot();
    }
    if(command==='disconnect'){logger.write('user.disconnect');await engine.stop();await captureNetwork('after.disconnect',true);return snapshot();}
    if(command==='diagnose'){logger.write('user.diagnose');await captureNetwork('user.diagnose');try{return {ok:true,latency:await engine.check()};}catch(error){logger.write('diagnose.error',{error});return {ok:false,message:'Ответ через тестовое соединение не получен.'};}}
    if(command==='testPage'){
      if(engine.state.status!=='connected'||!engine.state.port)throw Error('Сначала подключите тестовый доступ.');
      const isolated=session.fromPartition('zphone-test-'+Date.now());await isolated.setProxy({proxyRules:`http=127.0.0.1:${engine.state.port};https=127.0.0.1:${engine.state.port}`,proxyBypassRules:'<-loopback>'});
      const test=new BrowserWindow({width:900,height:720,title:'Проверка Zphone',webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true}});test.setMenuBarVisibility(false);
      test.webContents.setWindowOpenHandler(()=>({action:'deny'}));test.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('https://'))event.preventDefault();});
      await test.loadURL('https://www.cloudflare.com/cdn-cgi/trace');logger.write('test_page.loaded');return {ok:true};
    }
    if(command==='checkUpdates')return updates.check();
    if(command==='downloadUpdate')return updates.download();
    if(command==='installUpdate'){await updates.install({isBusy:busy});return {ok:true};}
    if(command==='minimize'){window.minimize();return {};}
    if(command==='close'){window.close();return {};}
    throw Error('Неизвестная команда.');
    }catch(error){logger.write('command.error',{command,error});throw error;}
  });
  await window.loadFile(entry);if(!quitting){const hidden=shouldStartHidden(settings,trayController)&&!showRequested;if(!hidden)window.show();logger.write('startup.ready',{hidden});}
}).catch(error=>{if(quitting)return;logger?.write('app.error',{error});logger?.flush();dialog.showErrorBox('Zphone Test',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;clearInterval(networkTimer);logger?.write('app.quit_requested');Promise.resolve(engine?.stop()).catch(error=>logger?.write('shutdown.error',{error})).finally(()=>{trayController?.dispose();logger?.write('app.quit');logger?.flush();app.quit();});});
}
