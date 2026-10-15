import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProfileRefresh,prepareVault} from '../desktop/profile-refresh.mjs';
import {validateBundle} from '../shared/profiles.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const bundle=id=>({format:'zphone-test-v1',scope:'test',profiles:[{id,location:'DEU',country:'CZ',protocol:'TrustTunnel',server:'192.0.2.1',port:443,username:'fixture',password:'fixture-only'}]});
const ready=()=>({state:'ready',bundle:bundle('fresh')});
function fixture(options={}){
  let time=1000,sequence=0;
  const timers=new Map();
  const f={calls:0,commits:0,discarded:0,notices:0,logs:[],status:'off',online:true,saved:bundle('old'),vault:{bundle:bundle('old'),marker:null}};
  f.account={token:'a'.repeat(43),state:'authorized',snapshot(){return {state:this.state};},async profiles(){f.calls++;return f.respond();}};
  f.respond=async()=>ready();
  f.prepare=async(value,marker)=>({commit:async()=>{f.commits++;f.vault={bundle:value,marker};},discard:async()=>{f.discarded++;}});
  f.coordinator=new ProfileRefresh({version:'0.6.9',account:f.account,isIdle:()=>['off','error'].includes(f.status),isOnline:()=>f.online,
    prepare:(...args)=>f.prepare(...args),apply:value=>{f.saved=value;},notify:()=>{f.notices++;},logger:{write:(event,fields)=>f.logs.push({event,...fields})},
    now:()=>time,setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:time+delay});return id;},clearTimer:id=>timers.delete(id),...options});
  f.timers=timers;f.advance=async ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}await flush();};
  return f;
}

test('legacy vault refreshes once; marker is private, atomic with bundle, and idempotent for version/session',async()=>{
  const f=fixture();await f.coordinator.wake();
  assert.equal(f.saved.profiles[0].id,'fresh');assert.equal(f.commits,1);assert.equal(f.vault.marker.source,'server');
  assert.deepEqual(f.coordinator.snapshot(),{state:'current',checkedAt:1000});
  assert.match(f.vault.marker.sessionHash,/^[a-f0-9]{64}$/);
  assert(!JSON.stringify([f.logs,f.coordinator.snapshot()]).includes(f.account.token));
  for(let i=0;i<10;i++)await f.coordinator.wake();assert.equal(f.calls,1);
  const restored=fixture({marker:f.vault.marker});await restored.coordinator.wake();assert.equal(restored.calls,0);
  const updated=fixture({version:'0.6.10',marker:f.vault.marker});await updated.coordinator.wake();assert.equal(updated.calls,1);
  const other=fixture({marker:f.vault.marker});other.account.token='b'.repeat(43);await other.coordinator.wake();assert.equal(other.calls,1);
});

test('no authorized session means no fetch, including a retained token with pending login',async()=>{
  for(const state of ['signed_out','pending','unconfigured']){
    const f=fixture();f.account.state=state;await f.coordinator.wake();assert.equal(f.calls,0);assert.equal(f.coordinator.snapshot().state,'idle');
    await assert.rejects(f.coordinator.refresh({manual:true}),{code:'PROFILE_SYNC_SIGN_IN'});
  }
  const f=fixture();f.account.token=null;await f.coordinator.wake();assert.equal(f.calls,0);
});

test('offline startup and transport failures preserve keys; backoff is bounded then event/cooldown driven',async()=>{
  const f=fixture();f.online=false;await f.coordinator.wake();assert.equal(f.calls,0);assert.equal(f.coordinator.snapshot().state,'retry');
  f.online=true;f.respond=async()=>{throw Error('private transport detail');};
  await f.advance(30000);assert.equal(f.calls,1);
  await f.advance(120000);assert.equal(f.calls,2);
  await f.advance(300000);assert.equal(f.calls,3);assert.equal(f.timers.size,0);
  for(let i=0;i<20;i++)await f.coordinator.wake();assert.equal(f.calls,3);
  await f.advance(300000);assert.equal(f.calls,3);
  f.respond=async()=>ready();await f.coordinator.wake();assert.equal(f.calls,4);assert.equal(f.coordinator.snapshot().state,'current');
  assert(!JSON.stringify(f.logs).includes('private transport detail'));
});

test('not-ready and malformed bundles never replace old keys or report manual success',async()=>{
  for(const response of [{state:'pending'},{state:'not_ready'},null,{state:'ready',bundle:{}},{state:'ready',bundle:{...bundle('bad'),profiles:[]}}]){
    const f=fixture();f.respond=async()=>response;
    await assert.rejects(f.coordinator.refresh({manual:true}),{code:'PROFILE_SYNC_FAILED'});
    assert.equal(f.saved.profiles[0].id,'old');assert.equal(f.commits,0);assert.equal(f.vault.marker,null);assert.equal(f.coordinator.snapshot().state,'retry');
  }
});

for(const status of [401,403])test(`${status} requires sign-in and stops automatic and manual retries until session changes`,async()=>{
  const f=fixture();f.respond=async()=>{throw Object.assign(Error('private response'),{status});};
  await assert.rejects(f.coordinator.refresh({manual:true}),{code:'PROFILE_SYNC_SIGN_IN'});
  assert.equal(f.coordinator.snapshot().state,'sign_in');assert.equal(f.timers.size,0);
  await f.advance(900000);await f.coordinator.wake();await assert.rejects(f.coordinator.refresh({manual:true}));assert.equal(f.calls,1);
  f.respond=async()=>ready();f.account.token='b'.repeat(43);await f.coordinator.wake();assert.equal(f.calls,2);assert.equal(f.coordinator.snapshot().state,'current');
});

test('staging and final rename failures leave old bundle and success marker untouched',async()=>{
  for(const stage of ['prepare','commit']){
    const f=fixture();f.prepare=async()=>{if(stage==='prepare')throw Error('disk');return {commit:async()=>{throw Error('disk');},discard:async()=>{f.discarded++;}};};
    await assert.rejects(f.coordinator.refresh({manual:true}),{code:'PROFILE_SYNC_FAILED'});
    assert.equal(f.vault.bundle.profiles[0].id,'old');assert.equal(f.saved.profiles[0].id,'old');assert.equal(f.vault.marker,null);assert.equal(f.coordinator.snapshot().state,'retry');
  }
});

test('manual and automatic calls share one flight; manual success marks the current version',async()=>{
  const f=fixture(),network=deferred();f.respond=()=>network.promise;
  const auto=f.coordinator.wake();await flush();const manual=f.coordinator.refresh({manual:true});await flush();assert.equal(f.calls,1);
  network.resolve(ready());await Promise.all([auto,manual]);assert.equal(f.commits,1);assert.equal(f.vault.marker.version,'0.6.9');
  await f.coordinator.wake();assert.equal(f.calls,1);
  f.respond=async()=>ready();await f.coordinator.refresh({manual:true});assert.equal(f.calls,2);
});

test('manual join of a failed automatic request throws instead of returning a success snapshot',async()=>{
  const f=fixture(),network=deferred();f.respond=()=>network.promise;
  const auto=f.coordinator.wake();await flush();const failed=assert.rejects(f.coordinator.refresh({manual:true}),{code:'PROFILE_SYNC_FAILED'});
  network.reject(Error('offline'));await Promise.all([auto,failed]);assert.equal(f.calls,1);assert.equal(f.commits,0);
});

test('token change discards old response and fetches only for the new authorized session',async()=>{
  const f=fixture(),network=deferred();f.respond=()=>network.promise;
  const old=f.coordinator.wake();await flush();f.account.token='b'.repeat(43);
  f.respond=async()=>({state:'ready',bundle:bundle('new-session')});network.resolve(ready());await old;await flush();
  assert.equal(f.commits,1);assert.equal(f.saved.profiles[0].id,'new-session');assert.equal(f.calls,2);
});

test('logout invalidates a response immediately, including while remote logout is still pending',async()=>{
  const f=fixture(),network=deferred(),logout=deferred();f.respond=()=>network.promise;
  const refresh=f.coordinator.wake();await flush();
  const signingOut=f.coordinator.sessionChange(async()=>{await logout.promise;f.account.token=null;f.account.state='signed_out';});
  network.resolve(ready());await refresh;assert.equal(f.commits,0);
  logout.resolve();await signingOut;assert.equal(f.coordinator.snapshot().state,'idle');assert.equal(f.timers.size,0);
});

test('manual import invalidates inflight response and suppresses auto for this version without claiming server freshness',async()=>{
  const f=fixture(),network=deferred();f.respond=()=>network.promise;
  const refresh=f.coordinator.wake();await flush();await f.coordinator.importProfiles(async()=>bundle('imported'));
  network.resolve(ready());await refresh;await f.coordinator.wake();
  assert.equal(f.saved.profiles[0].id,'imported');assert.equal(f.calls,1);assert.equal(f.commits,1);
  assert.equal(f.vault.marker.source,'import');assert.deepEqual(f.coordinator.snapshot(),{state:'idle'});
  const restored=fixture({marker:f.vault.marker});await restored.coordinator.wake();assert.equal(restored.calls,0);assert.equal(restored.coordinator.snapshot().state,'idle');
  f.respond=async()=>ready();await f.coordinator.refresh({manual:true});assert.equal(f.vault.marker.source,'server');
});

test('cancelled or invalid imports cannot replace keys or leave refreshing state stuck',async()=>{
  for(const value of [null,{}]){
    const f=fixture();if(value===null)await f.coordinator.importProfiles(async()=>value);else await assert.rejects(f.coordinator.importProfiles(async()=>value));
    assert.equal(f.saved.profiles[0].id,'old');assert.equal(f.commits,0);assert.equal(f.coordinator.snapshot().state,'pending');
  }
});

test('active tunnel defers before fetch; engine error is eligible',async()=>{
  for(const status of ['connecting','connected','checking','recovering','disconnecting']){
    const f=fixture();f.status=status;await f.coordinator.wake();assert.equal(f.calls,0);assert.equal(f.coordinator.snapshot().state,'deferred');
    f.status='error';await f.coordinator.wake();assert.equal(f.calls,1);assert.equal(f.commits,1);
  }
});

test('connect does not wait for network; a response while active cannot replace the vault',async()=>{
  const f=fixture(),network=deferred();f.respond=()=>network.promise;
  const refresh=f.coordinator.wake();await flush();await f.coordinator.connect(()=>{f.status='connected';});
  network.resolve(ready());await refresh;assert.equal(f.commits,0);assert.equal(f.coordinator.snapshot().state,'deferred');
  f.respond=async()=>ready();f.status='off';await f.coordinator.wake();assert.equal(f.calls,1);
  await f.advance(30000);assert.equal(f.commits,1);
});

test('connect reservation wins during staging, before the final rename',async()=>{
  const f=fixture(),staging=deferred(),preflight=deferred();
  f.prepare=async()=>{await staging.promise;return {commit:async()=>{f.commits++;},discard:async()=>{f.discarded++;}};};
  const refresh=f.coordinator.wake();await flush();const connect=f.coordinator.connect(async()=>{await preflight.promise;f.status='connected';});
  staging.resolve();await flush();assert.equal(f.commits,0);
  preflight.resolve();await Promise.all([refresh,connect]);assert.equal(f.commits,0);assert.equal(f.discarded,1);
});

test('final atomic save finishes before a queued connect uses the new keys',async()=>{
  const f=fixture(),rename=deferred();f.prepare=async(value,marker)=>({commit:async()=>{await rename.promise;f.vault={bundle:value,marker};f.commits++;},discard:async()=>{}});
  const refresh=f.coordinator.wake();await flush();let connected=false;
  const connect=f.coordinator.connect(()=>{assert.equal(f.saved.profiles[0].id,'fresh');connected=true;f.status='connected';});
  await flush();assert.equal(connected,false);assert.equal(f.coordinator.snapshot().state,'refreshing');assert.equal(f.vault.marker,null);
  rename.resolve();await Promise.all([refresh,connect]);assert.equal(connected,true);assert.equal(f.vault.marker.source,'server');
});

test('session mutation waits only for an already-started atomic commit, not an inflight fetch',async()=>{
  const f=fixture(),rename=deferred();f.prepare=async()=>({commit:()=>rename.promise,discard:async()=>{}});
  const refresh=f.coordinator.wake();await flush();let changed=false;
  const logout=f.coordinator.sessionChange(()=>{changed=true;f.account.token=null;f.account.state='signed_out';});
  await flush();assert.equal(changed,false);rename.resolve();await Promise.all([refresh,logout]);assert.equal(changed,true);assert.equal(f.coordinator.snapshot().state,'idle');
});

test('shutdown cancels timers and stale network/staging results without waiting for transport',async()=>{
  for(const phase of ['network','staging']){
    const f=fixture(),wait=deferred();if(phase==='network')f.respond=()=>wait.promise;else f.prepare=async()=>{await wait.promise;return {commit:async()=>{f.commits++;},discard:async()=>{}};};
    const refresh=f.coordinator.wake();await flush();await f.coordinator.shutdown();
    wait.resolve(ready());await refresh;await f.coordinator.wake();assert.equal(f.commits,0);assert.equal(f.timers.size,0);assert.equal(f.calls,1);
  }
  const f=fixture();f.online=false;await f.coordinator.wake();await f.coordinator.shutdown();assert.equal(f.timers.size,0);await f.advance(900000);assert.equal(f.calls,0);
});

test('atomic vault writer keeps previous bytes until rename and removes only its own temporary file',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'profile-refresh-')),vault=path.join(directory,'access.enc');
  try{
    await fs.writeFile(vault,'old encrypted fixture');
    const staged=await prepareVault(vault,Buffer.from('new encrypted fixture'));
    assert.equal(await fs.readFile(vault,'utf8'),'old encrypted fixture');await staged.commit();await staged.discard();
    assert.equal(await fs.readFile(vault,'utf8'),'new encrypted fixture');assert.deepEqual(await fs.readdir(directory),['access.enc']);
    const failed=await prepareVault(vault,Buffer.from('bad fixture'),{...fs,rename:async()=>{throw Error('locked');}});
    await assert.rejects(failed.commit());await failed.discard();assert.equal(await fs.readFile(vault,'utf8'),'new encrypted fixture');
    await assert.rejects(prepareVault(vault,Buffer.from('bad fixture'),{...fs,open:async(...args)=>{const file=await fs.open(...args);return {writeFile:async()=>{throw Error('full');},close:()=>file.close()};}}));
    assert.deepEqual(await fs.readdir(directory),['access.enc']);
  }finally{await fs.rm(vault,{force:true});await fs.rmdir(directory);}
});

test('vault marker is ignored by public bundle validation and logs contain only bounded metadata',async()=>{
  const f=fixture();await f.coordinator.wake();
  assert.equal(validateBundle({...f.vault.bundle,profileSync:f.vault.marker}).profileSync,undefined);
  for(const entry of f.logs)assert(Object.keys(entry).every(key=>['event','version','status','code','statusCode','count'].includes(key)));
  assert(!JSON.stringify(f.logs).includes('fixture-only'));assert(!JSON.stringify(f.coordinator.snapshot()).includes('sessionHash'));
});
