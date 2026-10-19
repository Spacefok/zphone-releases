import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {SettingsStore} from '../desktop/settings-store.mjs';
const defaults={theme:'system',location:'auto',protocol:'auto',split:{mode:'all',apps:[]},autoCheckUpdates:true};
const old={theme:'dark',location:'FIN',protocol:'AmneziaWG',split:{mode:'exclude',apps:[{id:'C:\\Apps\\edge.exe',name:'Edge'}]},autoDownloadUpdates:false,startInTray:true};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-settings-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'settings.json');}
test('upgrade loads legacy settings, preserves exclusions and merges new defaults',async t=>{
 const file=await fixture(t);await fs.writeFile(file,JSON.stringify(old));const store=new SettingsStore(file,defaults);const value=await store.load();
 assert.deepEqual(value,{...defaults,...old});assert.deepEqual(JSON.parse(await fs.readFile(file+'.bak','utf8')),value);
 const restarted=new SettingsStore(file,{...defaults,updateWifiOnly:true});assert.deepEqual(await restarted.load(),{...value,updateWifiOnly:true});
});
test('partial changes, parallel saves and restarts retain routing preferences',async t=>{
 const file=await fixture(t);await fs.writeFile(file,JSON.stringify(old));const store=new SettingsStore(file,defaults);await store.load();
 await Promise.all([store.update(s=>({...s,theme:'light'})),store.update(s=>({...s,startInTray:false}))]);
 const value=await new SettingsStore(file,defaults).load();assert.equal(value.theme,'light');assert.equal(value.startInTray,false);assert.deepEqual(value.split,old.split);assert.equal(value.location,'FIN');
});
test('truncated or missing main settings recover the last durable copy',async t=>{
 const file=await fixture(t);const store=new SettingsStore(file,defaults);await store.load();await store.update(()=>old);
 for(const value of ['{broken',null]){if(value===null)await fs.unlink(file);else await fs.writeFile(file,value);assert.deepEqual((await new SettingsStore(file,defaults).load()).split,old.split);}
});
test('unrecoverable settings fail closed without destroying the evidence',async t=>{
 const file=await fixture(t);await fs.writeFile(file,'{broken');await assert.rejects(new SettingsStore(file,defaults).load(),/сброс отменён/);assert.equal(await fs.readFile(file,'utf8'),'{broken');
});
test('partially missing preferences and invalid null split use the saved backup',async t=>{
 const file=await fixture(t);const store=new SettingsStore(file,defaults);await store.load();await store.update(()=>old);
 await fs.writeFile(file,JSON.stringify({theme:'light'}));assert.deepEqual((await new SettingsStore(file,defaults).load()).split,old.split);
 await fs.writeFile(file,JSON.stringify({split:null}));assert.deepEqual((await new SettingsStore(file,defaults).load()).split,old.split);
});
test('failed atomic replacement does not truncate the current file',async t=>{
 const file=await fixture(t);await fs.writeFile(file,JSON.stringify(old));let fail=false;
 const io={...fs,rename:async(from,to)=>{if(fail&&to===file)throw Object.assign(Error('blocked'),{code:'EACCES'});return fs.rename(from,to);}};
 const store=new SettingsStore(file,defaults,{io});await store.load();fail=true;await assert.rejects(store.update(s=>({...s,theme:'light'})),/blocked/);assert.equal(store.snapshot().theme,'dark');
 assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),old);assert(!(await fs.readdir(path.dirname(file))).some(n=>n.endsWith('.tmp')));
});
test('invalid split and failed startup side effects preserve prior settings',async t=>{
 const file=await fixture(t);const store=new SettingsStore(file,defaults);await store.load();await store.update(()=>old);
 await assert.rejects(store.update(s=>({...s,split:{mode:'all',apps:'bad'}})));
 await assert.rejects(store.update(s=>({...s,theme:'light'}),()=>{throw Error('startup failed');}));
 assert.deepEqual((await new SettingsStore(file,defaults).load()).split,old.split);assert.equal(store.snapshot().theme,'dark');
});
