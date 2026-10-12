import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticFlow} from '../src/diagnostic-state.js';

const snapshot=()=>({connection:{status:'connected',port:1234,latency:245,route:{location:'FIN',protocol:'AmneziaWG'}},settings:{location:'FIN',protocol:'AmneziaWG',mode:'vpn',split:{mode:'all',apps:[]}},account:{state:'authorized'}});
const success={ok:true,latency:269};
test('diagnostic result clears on status, route, port, routing or account context changes',async()=>{
  const changes=[...['off','error','recovering','connecting','disconnecting'].map(status=>s=>s.connection.status=status),
    s=>s.connection.route.location='AMS',s=>s.connection.route.protocol='Mieru',s=>s.connection.port=2345,
    s=>s.settings.mode='isolated',s=>s.settings.location='AMS',s=>s.settings.protocol='Mieru',
    s=>s.settings.split.mode='exclude',s=>s.settings.split.apps=[{id:'org.example.app'}],s=>s.account.state='signed_out'];
  for(const change of changes){const state=snapshot(),flow=createDiagnosticFlow(async()=>success);flow.accept(state);await flow.run();change(state);flow.accept(state);assert.equal(flow.result,null);}
});
test('routine latency, counters, theme and update changes preserve a same-context diagnostic',async()=>{
  const state=snapshot(),flow=createDiagnosticFlow(async()=>success);flow.accept(state);await flow.run();
  state.connection.latency=300;state.connection.uploadBytes=1200;state.settings.theme='dark';state.updates={state:'current'};
  flow.accept(state);assert.deepEqual(flow.result,success);
});
test('late success or rejection cannot restore a diagnostic after leaving its context',async()=>{
  for(const rejects of [false,true]){
    let finish;const state=snapshot(),flow=createDiagnosticFlow(()=>new Promise((resolve,reject)=>{finish=()=>rejects?reject(Error('late failure')):resolve(success);}));
    flow.accept(state);const pending=flow.run();state.connection.status='off';flow.accept(state);finish();
    assert.equal(await pending,null);assert.equal(flow.result,null);
  }
});
test('old request cannot overwrite a newer result after disconnect and reconnect',async()=>{
  const resolves=[],state=snapshot(),flow=createDiagnosticFlow(()=>new Promise(resolve=>resolves.push(resolve)));
  flow.accept(state);const old=flow.run();state.connection.status='off';flow.accept(state);state.connection.status='connected';flow.accept(state);
  const fresh=flow.run();resolves[1]({ok:true,latency:31});await fresh;resolves[0](success);await old;
  assert.deepEqual(flow.result,{ok:true,latency:31});
});
test('duplicate diagnostic clicks share one flight and current failures remain actionable',async()=>{
  let reject,calls=0;const flow=createDiagnosticFlow(command=>{assert.equal(command,'diagnose');calls++;return new Promise((_,r)=>reject=r);});
  flow.accept(snapshot());const first=flow.run();assert.equal(flow.run(),first);assert.equal(calls,1);
  reject(Error('private detail'));await first;assert.deepEqual(flow.result,{ok:false,message:'Проверка не завершилась.'});
});
