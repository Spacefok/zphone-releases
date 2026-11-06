import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Diagnostics} from '../desktop/diagnostics.mjs';
import {createIssueReport,reportFields} from '../desktop/diagnostics-report.mjs';
import {saveProbeHistory,readProbeHistory} from '../desktop/probe-history.mjs';

async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-probe-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
const id='abcdefab-1234-4567-8901-abcdefabcdef';
test('before-disconnect samples survive rotation/restart and are reported once with original route and time',async t=>{
  const directory=await fixture(t),logger=new Diagnostics(directory,{maxBytes:500,maxFiles:2});
  const sample={stage:'probe',attempt:6,phase:'request',transport:'proxy',ok:false,errorCode:'TLS_ERROR',location:'AMS',protocol:'AmneziaWG'};
  logger.write('health.check',sample);logger.flush();const initial=await createIssueReport(logger,{connectionStatus:'off'});
  assert.equal(initial.records.filter(r=>r.data.attempt===6).length,1);
  const time=initial.records.find(r=>r.data.attempt===6).time;
  for(let i=0;i<10;i++){logger.write('core.log',{message:'x'.repeat(400)});logger.flush();}
  const restarted=new Diagnostics(directory),report=await createIssueReport(restarted,{connectionStatus:'off'});
  assert.equal(report.records.length,1);assert.deepEqual(report.records[0].data,sample);assert.equal(report.records[0].time,time);
});
test('cache expires, drops unknown data and stays bounded without sending anything',async t=>{
  const directory=await fixture(t),now=Date.now();
  const row=age=>({time:new Date(now-age).toISOString(),session:id,event:'health.check',data:{stage:'probe',attempt:7,ok:true,host:'private.example',password:'secret',url:'https://private/'}});
  saveProbeHistory(directory,[row(180001),row(-1),...Array.from({length:200},(_,i)=>row(i))],reportFields,now);
  assert.equal(readProbeHistory(directory,reportFields,now).length,128);
  const text=await fs.readFile(path.join(directory,'service-probes.json'),'utf8');assert(!text.includes('private'));assert(!text.includes('secret'));
  assert.deepEqual(readProbeHistory(directory,reportFields,now+180001),[]);
  await fs.writeFile(path.join(directory,'service-probes.json'),'broken');assert.deepEqual(readProbeHistory(directory,reportFields,now),[]);
});
