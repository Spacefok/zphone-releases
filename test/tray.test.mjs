import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createTray} from '../desktop/tray.cjs';
function fixture(){
  let item,stopped=0,quits=0,quitting=false,state={status:'connected',mode:'vpn',route:{location:'FIN',protocol:'AmneziaWG'}};
  class Tray extends EventEmitter{constructor(){super();item=this;}setToolTip(t){this.tooltip=t;}setContextMenu(m){this.menu=m;}destroy(){this.destroyed=true;}}
  const window=Object.assign(new EventEmitter(),{visible:true,minimized:false,isDestroyed:()=>false,isMinimized(){return this.minimized;},restore(){this.minimized=false;},show(){this.visible=true;},hide(){this.visible=false;},focus(){this.focused=true;}});
  const controller=createTray({Tray,Menu:{buildFromTemplate:t=>t},nativeImage:{createFromPath:()=>({isEmpty:()=>false})},window,iconPath:'unused',getState:()=>state,isQuitting:()=>quitting,disconnect:async()=>{stopped++;state={status:'off'};controller.update();},quit:()=>{quitting=true;quits++;}});
  return {window,item,controller,get stopped(){return stopped;},get quits(){return quits;},setState:s=>{state=s;controller.update();}};
}
test('minimize and close hide the window without disconnecting or quitting',()=>{
  const f=fixture();try{for(const event of ['minimize','close']){let prevented=false;f.window.emit(event,{preventDefault:()=>prevented=true});assert(prevented);assert(!f.window.visible);assert.equal(f.stopped,0);assert.equal(f.quits,0);f.item.emit('click');assert(f.window.visible);}}finally{f.controller.dispose();}
});
test('tray menu reflects the route and safely disconnects only on explicit action',async()=>{
  const f=fixture();try{assert.match(f.item.tooltip,/FIN.*AmneziaWG/);const disconnect=f.item.menu.find(i=>i.id==='disconnect');assert(disconnect.enabled);await disconnect.click();assert.equal(f.stopped,1);assert.equal(f.item.menu.find(i=>i.id==='disconnect').enabled,false);assert.match(f.item.tooltip,/Не подключено/);}finally{f.controller.dispose();}
});
test('tray exit allows window close and disposal removes event handlers',()=>{
  const f=fixture();f.item.menu.find(i=>i.id==='quit').click();assert.equal(f.quits,1);let prevented=false;f.window.emit('close',{preventDefault:()=>prevented=true});assert(!prevented);f.controller.dispose();f.controller.dispose();assert(f.item.destroyed);assert.equal(f.window.listenerCount('close'),0);
});
test('missing tray icon does not intercept window close',()=>{
  const window=new EventEmitter();assert.throws(()=>createTray({nativeImage:{createFromPath:()=>({isEmpty:()=>true})},window}),/icon unavailable/);assert.equal(window.listenerCount('close'),0);
});

test('tray distinguishes a local proxy from full VPN without pilot branding',()=>{
  const f=fixture();try{
    f.setState({status:'connected',mode:'isolated',route:{location:'FIN',protocol:'AmneziaWG'}});
    assert.equal(f.item.tooltip,'Zphone · Прокси подключён · FIN · AmneziaWG');
    assert.match(f.item.menu.find(i=>i.id==='open').label,/^Открыть Zphone$/);
  }finally{f.controller.dispose();}
});

test('tray initialization failure restores normal window behavior',()=>{
  const window=new EventEmitter();let destroyed=false;
  class Tray extends EventEmitter{setToolTip(){}destroy(){destroyed=true;}}
  assert.throws(()=>createTray({Tray,window,Menu:{buildFromTemplate(){throw Error('Menu failed');}},nativeImage:{createFromPath:()=>({isEmpty:()=>false})},getState:()=>({status:'off'})}),/Menu failed/);
  assert(destroyed);assert.equal(window.listenerCount('close'),0);assert.equal(window.listenerCount('minimize'),0);
});
