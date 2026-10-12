import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../desktop/engine.mjs';
import {conflictingAdapters} from '../desktop/windows-network.mjs';
const profiles=[{id:'fin-awg',location:'FIN',protocol:'AmneziaWG'},{id:'ams-awg',location:'AMS',protocol:'AmneziaWG'},{id:'fin-mieru',location:'FIN',protocol:'Mieru'}];
const selection={location:'FIN',protocol:'AmneziaWG',split:{mode:'include',apps:[{id:'C:\\Windows\\System32\\curl.exe',name:'curl'}]}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
class Fake extends Engine {
  constructor(options={}){super({binary:'unused',directory:'unused',retryDelays:[1,2,3],...options});this.launched=[];this.events=[];this.onState=s=>this.events.push({...s});}
  async cleanup(){clearInterval(this.monitor);this.active=null;}
  async launch(profile,mode,generation,split){this.launched.push({id:profile.id,mode,split});if(this.fail)throw Error('Unavailable');this.active={port:19000};}
  async check(){if(this.healthFails)throw Error('No internet');return 10;}
}
test('recovery retains manual location/protocol and the original split settings',async()=>{
  const e=new Fake();try{await e.start(profiles,selection,'vpn');await e.recover('test');assert.equal(e.state.status,'connected');assert.deepEqual(e.launched.map(p=>p.id),['fin-awg','fin-awg']);assert.deepEqual(e.launched[1].split,selection.split);}finally{await e.stop();}
});
test('manual disconnect cancels backoff and never reconnects from off',async()=>{
  const e=new Fake({retryDelays:[60000]});await e.start(profiles,selection);void e.recover('test');await pause(10);await e.stop();await e.recover('resume');assert.equal(e.state.status,'off');assert.equal(e.launched.length,1);assert.equal(e.retrying,false);
});
test('persistent VPN conflict exhausts bounded checks without starting a core',async()=>{
  let checks=0;
  const e=new Fake({beforeReconnect:async()=>{checks++;throw Object.assign(Error('Other VPN'),{code:'VPN_CONFLICT'});}});
  try{await e.start(profiles,selection,'vpn');await e.recover('test');assert.equal(checks,3);assert.equal(e.state.status,'error');assert.equal(e.state.error,'Other VPN');assert.equal(e.launched.length,1);}finally{await e.stop();}
});

test('FIN AWG recovery waits for the temporary Radmin route to return to Ethernet',async()=>{
  const radmin={Name:'Radmin VPN',InterfaceDescription:'Famatech Radmin VPN Ethernet Adapter',Status:'Up',ifIndex:7};
  let checks=0;
  const e=new Fake({beforeReconnect:async mode=>{
    assert.equal(mode,'vpn');assert.equal(e.state.status,'recovering');assert.equal(e.launched.length,1);
    const routedInterfaces=++checks<3?[7]:[4];
    if(conflictingAdapters({adapters:[radmin],routedInterfaces}).length)throw Object.assign(Error('Other VPN'),{code:'VPN_CONFLICT'});
  }});
  try{await e.start(profiles,selection,'vpn');await e.recover('health');assert.equal(checks,3);assert.equal(e.state.status,'connected');assert(!e.events.some(s=>s.status==='error'));assert.deepEqual(e.launched.map(p=>p.id),['fin-awg','fin-awg']);assert.deepEqual(e.launched[1].split,selection.split);}finally{await e.stop();}
});

test('a conflict before a fallback candidate waits for the next recovery round',async()=>{
  let checks=0;
  const e=new Fake({beforeReconnect:async()=>{if(++checks===2)throw Object.assign(Error('Other VPN'),{code:'VPN_CONFLICT'});}});
  try{
    await e.start(profiles,{location:'FIN',protocol:'auto'},'vpn');
    const launch=e.launch.bind(e);let failOnce=true;
    e.launch=async(...args)=>{if(failOnce){failOnce=false;throw Error('Unavailable');}return launch(...args);};
    await e.recover('test');assert.equal(checks,3);assert.equal(e.state.status,'connected');assert.equal(e.launched.length,2);
  }finally{await e.stop();}
});

test('missing administrator rights still abort recovery immediately',async()=>{
  let checks=0;
  const e=new Fake({beforeReconnect:async()=>{checks++;throw Object.assign(Error('Admin required'),{code:'ADMIN_REQUIRED'});}});
  try{await e.start(profiles,selection,'vpn');await e.recover('test');assert.equal(checks,1);assert.equal(e.launched.length,1);assert.equal(e.state.status,'error');assert.equal(e.state.error,'Admin required');}finally{await e.stop();}
});

test('manual disconnect cancels waiting for a conflicting VPN to clear',async()=>{
  let entered;const blocked=new Promise(r=>entered=r);
  const e=new Fake({retryDelays:[1,60000],beforeReconnect:async()=>{entered();throw Object.assign(Error('Other VPN'),{code:'VPN_CONFLICT'});}});
  try{await e.start(profiles,selection,'vpn');const restoring=e.recover('test');await blocked;await e.stop();await restoring;assert.equal(e.state.status,'off');assert.equal(e.launched.length,1);assert.equal(e.retrying,false);}finally{await e.stop();}
});
test('disconnect while preflight is pending prevents launch',async()=>{
  let release,entered;const ready=new Promise(r=>entered=r);const e=new Fake({beforeReconnect:async()=>{entered();await new Promise(r=>release=r);}});
  await e.start(profiles,selection);const restoring=e.recover('test');await ready;const stopping=e.stop();release();await restoring;await stopping;assert.equal(e.launched.length,1);assert.equal(e.state.status,'off');
});
test('failed recovery has a bounded attempt count and reports failure',async()=>{
  const e=new Fake();try{await e.start(profiles,selection);e.fail=true;await e.recover('test');assert.equal(e.launched.length,4);assert.equal(e.state.status,'error');assert.equal(e.active,null);}finally{await e.stop();}
});
test('monitor requires two failed checks and does not race a second recovery',async()=>{
  const e=new Fake({monitorMs:5});try{await e.start(profiles,selection);e.healthFails=true;for(let i=0;i<100&&e.state.status!=='error';i++)await pause(5);assert.equal(e.state.status,'error');assert.equal(e.launched.length,4);assert.equal(e.events.filter(s=>s.retryAttempt===0).length,1);}finally{await e.stop();}
});
test('automatic recovery prefers last successful access but stays within location',async()=>{
  const e=new Fake();try{await e.start(profiles,{location:'FIN',protocol:'auto'});e.lastProfile='fin-awg';await e.recover('test');assert.equal(e.launched.at(-1).id,'fin-awg');assert(!e.launched.some(p=>p.id==='ams-awg'));}finally{await e.stop();}
});
test('cleanup failures are contained and do not leave a rejected recovery promise',async()=>{
  const e=new Fake();await e.start(profiles,selection);const cleanup=e.cleanup.bind(e);e.cleanup=async()=>{await cleanup();throw Error('Cleanup failed');};await e.recover('test');assert.equal(e.state.status,'error');e.cleanup=cleanup;await e.stop();
});
