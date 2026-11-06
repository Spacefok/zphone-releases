import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HEALTH_TARGETS,checkHealth} from '../desktop/health-check.mjs';
import {Engine} from '../desktop/engine.mjs';

test('one or two failed sites cannot mark a reachable tunnel as offline',async()=>{
  for(let failed=1;failed<=2;failed++){
    const records=[];
    assert.equal(await checkHealth({request:async url=>{if(HEALTH_TARGETS.indexOf(url)<failed)throw Error('blocked');return 42;},record:row=>records.push(row)}),42);
    assert.equal(records.length,3);assert.equal(records.filter(row=>!row.ok).length,failed);
    assert(records.every(row=>row.stage==='health'&&row.phase==='request'));
  }
});
test('total outage, invalid delays and a replaced connection never report success',async()=>{
  await assert.rejects(checkHealth({request:async()=>{throw Error('offline');}}),{code:'ENETUNREACH'});
  await assert.rejects(checkHealth({request:async()=>NaN}),{code:'ENETUNREACH'});
  await assert.rejects(checkHealth({request:async()=>20,valid:()=>false}),{code:'ECANCELED'});
});
test('engine pins the API connection for the complete round and records target ordinals',async()=>{
  const calls=[],records=[],engine=new Engine({logger:{write:(event,data)=>records.push({event,data})}});
  engine.active={apiPort:1234,secret:'not-to-log'};engine.state={route:{location:'AMS',protocol:'TrustTunnel'}};
  engine.api=async(route,timeout,active)=>{calls.push({route,timeout,active});if(route.includes(encodeURIComponent(HEALTH_TARGETS[0])))throw Error('blocked');return {delay:50};};
  assert.equal(await engine.check(),50);assert.equal(calls.length,3);assert(calls.every(call=>call.active===engine.active));
  assert.equal(records.filter(row=>row.event==='health.proxy_ok').length,1);assert(!JSON.stringify(records).includes('not-to-log'));
});
test('Android uses the identical independent health target set',()=>{
  const source=fs.readFileSync('android/app/src/main/java/org/zphone/pilot/HealthCheck.java','utf8');
  assert.deepEqual(source.match(/TARGETS=List.of\(([^;]+)\);/)[1].match(/"([^"]+)"/g).map(x=>JSON.parse(x)),HEALTH_TARGETS);
});

test('live monitor logic does not recover from one blocked site, but does after two complete failed rounds',async()=>{
  const events=[];
  class TestEngine extends Engine {
    async cleanup(){clearInterval(this.monitor);this.active=null;}
    async launch(){this.active={port:1234};}
    async api(route){
      if(this.outage||route.includes(encodeURIComponent(HEALTH_TARGETS[0])))throw Error('blocked');
      return {delay:12};
    }
  }
  const engine=new TestEngine({monitorMs:5,retryDelays:[1],logger:{write:(event,data)=>events.push({event,data}),protectProfiles(){}}});
  const waitFor=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert(predicate());};
  try{
    await engine.start([{id:'test',location:'AMS',protocol:'AmneziaWG'}],{location:'AMS',protocol:'AmneziaWG'});
    await waitFor(()=>events.filter(row=>row.event==='health.proxy_ok').length>=3);
    assert.equal(engine.state.status,'connected');assert(!events.some(row=>row.event==='recovery.request'));
    engine.outage=true;await waitFor(()=>engine.state.status==='error');
    assert.equal(events.filter(row=>row.event==='recovery.request').length,1);
    assert.deepEqual(events.filter(row=>row.event==='health.failed').map(row=>row.data.failures),[1,2]);
  }finally{await engine.stop();}
});
