import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('desktop bridge permits application pickers and rejects unknown commands',async()=>{
  let bridge;
  const calls=[];
  const electron={
    contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'zphone');bridge=value;}},
    ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {ok:true};}},
  };
  vm.runInNewContext(fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return electron;}});
  for(const command of ['listApps','pickApp','openSupport','markIssue']){
    assert.deepEqual(await bridge.request(command),{ok:true});
    assert.equal(calls.at(-1)[1],command);
  }
  await assert.rejects(bridge.request('execute'),/Unknown command/);
  assert.equal(calls.length,4);
});
