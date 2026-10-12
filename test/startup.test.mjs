import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartup,shouldStartHidden,elevatedStartup,STARTUP_ARGS,STARTUP_NAME} from '../desktop/startup.cjs';
function fixture(options={}){
  let entries=[],writes=[];
  const executable='C:\\Zphone Test\\Zphone-Test.exe';
  const app={isPackaged:true,getLoginItemSettings:({path})=>({launchItems:entries.filter(item=>item.path.toLowerCase()===path.toLowerCase())}),setLoginItemSettings:settings=>{
    writes.push(settings);entries=entries.filter(item=>item.name!==settings.name);if(settings.openAtLogin)entries.push({...settings,scope:'user'});
  }};
  const controller=createStartup({app,executable,available:true,...options});
  return {controller,writes,app,executable,setEntries:value=>{entries=value;}};
}
test('startup is opt-in and registering quotes via the native API, not a shell',()=>{
  const f=fixture();assert.equal(f.controller.read().enabled,false);assert.equal(f.writes.length,0);
  assert.equal(f.controller.set(true).enabled,true);assert.deepEqual(f.writes[0],{name:STARTUP_NAME,path:f.executable,args:STARTUP_ARGS,openAtLogin:true,enabled:true});
  assert.equal(f.controller.set(false).enabled,false);assert.equal(f.controller.read().registered,false);
});
test('startup ignores other registry entries and respects Task Manager disablement',()=>{
  const f=fixture();f.setEntries([{name:'OtherApp',path:f.executable,args:STARTUP_ARGS,scope:'user',enabled:true}]);assert.equal(f.controller.read().enabled,false);
  f.setEntries([{name:STARTUP_NAME,path:f.executable,args:STARTUP_ARGS,scope:'user',enabled:false}]);assert.equal(f.controller.read().registered,true);assert.equal(f.controller.read().enabled,false);assert.equal(f.writes.length,0);
});
test('a saved older portable path remains visible and explicit enable replaces it',()=>{
  const f=fixture({storedPath:'C:\\Previous\\Zphone-Test.exe'});f.setEntries([{name:STARTUP_NAME,path:'C:\\Previous\\Zphone-Test.exe',args:STARTUP_ARGS,scope:'user',enabled:true}]);
  assert.equal(f.controller.read().enabled,true);assert.equal(f.controller.read().otherVersion,true);assert.equal(f.controller.set(true).otherVersion,false);
});
test('unavailable or unsuccessful registration cannot be reported as enabled',()=>{
  const f=fixture({available:false});assert.equal(f.controller.read().available,false);assert.throws(()=>f.controller.set(true));assert.equal(f.writes.length,0);
  const g=fixture();g.app.setLoginItemSettings=()=>{};assert.throws(()=>g.controller.set(true),/не подтвердила/);assert.throws(()=>g.controller.set('true'),/Некорректная/);
});
test('start hidden is independent of login registration and needs a usable tray',()=>{
  assert.equal(shouldStartHidden({},true),false);assert.equal(shouldStartHidden({startInTray:true},true),true);
  assert.equal(shouldStartHidden({startInTray:true,startWithWindows:false},true),true);
  assert.equal(shouldStartHidden({startInTray:false,startWithWindows:true},true),false);
  assert.equal(shouldStartHidden({startInTray:true},false),false);assert.equal(shouldStartHidden({startInTray:'true'},true),false);
});
test('elevated startup explicitly requests UAC, escapes paths and remains opt-in',()=>{
  const path="C:\\User's files\\Zphone-Preview.exe",launch=elevatedStartup(path);
  assert.match(launch.path,/WindowsPowerShell/);
  const script=Buffer.from(launch.args.at(-1),'base64').toString('utf16le');
  assert.equal(script,"Start-Process -FilePath 'C:\\User''s files\\Zphone-Preview.exe' -Verb RunAs -WindowStyle Hidden");
  const f=fixture({elevation:true});assert.equal(f.writes.length,0);assert.equal(f.controller.set(true).enabled,true);assert.deepEqual(f.writes[0].args,elevatedStartup(f.executable).args);assert.equal(f.controller.set(false).enabled,false);
});
test('legacy opt-in startup can migrate without changing unrelated entries',()=>{
  const f=fixture({elevation:true});f.setEntries([{name:STARTUP_NAME,path:f.executable,args:STARTUP_ARGS,scope:'user',enabled:true}]);
  assert.equal(f.controller.read().legacy,true);assert.equal(f.writes.length,0);f.controller.set(true);assert.equal(f.controller.read().legacy,false);
});
