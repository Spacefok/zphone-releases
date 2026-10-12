import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Engine} from '../desktop/engine.mjs';
test('a signal-terminated process is treated as stopped',async()=>{
  const engine=new Engine({binary:'unused',directory:'unused'});
  const child=new EventEmitter();Object.assign(child,{pid:123,exitCode:null,signalCode:null});
  child.kill=()=>{child.signalCode='SIGTERM';child.emit('exit',null,'SIGTERM');return true;};
  engine.child=child;engine.state={status:'connected'};await engine.stop();
  assert.equal(engine.child,null);assert.equal(engine.state.status,'off');
});
test('spawn failure without a PID can be cleaned up',async()=>{
  const engine=new Engine({binary:'unused',directory:'unused'});engine.child={pid:undefined,exitCode:null,signalCode:null};await engine.stop();assert.equal(engine.child,null);
});
class FakeEngine extends Engine {
  constructor(){super({binary:'unused',directory:'unused'});this.attempts=[];}
  async cleanup(){clearInterval(this.monitor);this.monitor=null;this.active=null;}
  async launch(profile){this.attempts.push(profile.id);if(profile.id==='unavailable')throw Error('Unavailable');this.active={port:19000};}
  async check(){return 25;}
}
test('automatic selection advances to the next available test profile',async()=>{
  const engine=new FakeEngine();
  try{
    await engine.start([{id:'unavailable',location:'AMS',protocol:'TrustTunnel'},{id:'available',location:'FIN',protocol:'Mieru'}],{location:'auto',protocol:'auto'});
    assert.deepEqual(engine.attempts,['unavailable','available']);assert.equal(engine.state.status,'connected');assert.equal(engine.state.route.protocol,'Mieru');
  }finally{await engine.stop();}
});
test('manual protocol failure does not start another protocol',async()=>{
  const engine=new FakeEngine();
  try{
    await engine.start([{id:'unavailable',location:'FIN',protocol:'TrustTunnel'},{id:'available',location:'FIN',protocol:'Mieru'}],{location:'FIN',protocol:'TrustTunnel'});
    assert.deepEqual(engine.attempts,['unavailable']);assert.equal(engine.state.status,'error');
  }finally{await engine.stop();}
});
test('cancelling during launch never publishes a connected state',async()=>{
  const states=[],engine=new FakeEngine();engine.onState=state=>states.push(state.status);
  let finish,started;const launched=new Promise(r=>started=r);
  engine.launch=async()=>{started();await new Promise(r=>finish=r);engine.active={port:19000};};
  const connecting=engine.start([{id:'available',location:'FIN',protocol:'TrustTunnel'}],{location:'auto',protocol:'auto'});
  await launched;const stopping=engine.stop();finish();await connecting;await stopping;
  assert.equal(engine.state.status,'off');assert(!states.includes('connected'));
});
