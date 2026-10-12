import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Diagnostics} from '../desktop/diagnostics.mjs';
import {createIssueReport,REPORT_BYTES,REPORT_WINDOW_MS,REPORT_RECORDS,reportFields} from '../desktop/diagnostics-report.mjs';
import {Account} from '../desktop/account.mjs';
import {createIssueFlow,REPORT_CONSENT,REPORT_ACCEPTED} from '../src/issue-report.js';

const now=Date.parse('2026-10-12T12:00:00.000Z'),id='abcdefab-1234-4567-8901-abcdefabcdef';
const metadata={version:'0.6.7',build:'windows-20261012.17',platform:'windows',connectionStatus:'error',location:'FIN',protocol:'TrustTunnel',mode:'vpn',splitMode:'all',splitAppCount:0,profileCount:10};
const record=(age,data={},event='health.check')=>({time:new Date(now-age).toISOString(),session:id,event,data});
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-report-')),logger=new Diagnostics(directory);
  t.after(async()=>{logger.flush();await fs.rm(directory,{recursive:true,force:true});});
  return {logger,directory,write:(name,rows)=>fs.writeFile(path.join(directory,name),rows.map(row=>typeof row==='string'?row:JSON.stringify(row)).join('\n')+'\n')};
}
async function accountFixture(t,transport,config={baseUrl:'https://first.invalid'}){
  const result=await fixture(t),account=new Account({config,readToken:async()=> 't'.repeat(43),writeToken:async()=>{},transport});
  await account.restore();t.after(()=>account.clearReport());return {...result,account};
}
test('inclusive 180-second window spans rotated files, rejects future/malformed rows and preserves sessions',async t=>{
  const {logger,write}=await fixture(t);
  await write('diagnostics.jsonl',[record(-1),{...record(0),time:'2026-10-12T12:00:00.000000001Z'},{...record(0),session:[id]},record(0,{latency:1}),record(1000),'{bad',record(0,{},'core.log')]);
  await write('diagnostics.1.jsonl',[record(180000),record(180001),{...record(20),session:'bad'}, {...record(0),time:'not a timestamp'}]);
  await write('diagnostics.4.jsonl',[record(120000)]);
  const report=await createIssueReport(logger,metadata,{now,reportId:id});
  assert.deepEqual(report.summary,metadata);assert.deepEqual(report.records.map(r=>Date.parse(r.time)),[now-180000,now-120000,now-1000,now]);
  assert(report.records.every(r=>r.session===id));assert.equal(report.reportId,id);assert.equal(report.created,new Date(now).toISOString());
});
test('second privacy pass excludes raw core/network data, old unsafe logs, nested credentials and browsing metadata',async t=>{
  const {logger,write}=await fixture(t);
  const dirty={...metadata,password:'super-secret',token:'t'.repeat(43),site:'visited.example',message:'https://visited.example/path?q=secret C:\\Users\\Alice\\private /home/alice',profile:{location:'FIN',protocol:'Mieru',server:'server.private',password:'super-secret'},error:{name:'Error',code:'ECONNRESET',message:'visited.example'},split:{mode:'include',count:2,apps:['private.exe']},latency:123,ok:false};
  await write('diagnostics.jsonl',[record(10,dirty),record(10,dirty,'core.log'),record(10,dirty,'network.snapshot'),record(10,dirty,'visited.example')]);
  const report=await createIssueReport(logger,dirty,{now,reportId:id}),text=JSON.stringify(report);
  assert.equal(report.records.length,1);assert.equal(report.records[0].data.errorCode,'ECONNRESET');assert.equal(report.records[0].data.latency,123);
  for(const value of ['super-secret','visited','server.private','private.exe','Alice','alice','https:','token','password','message','core.log','network.snapshot'])assert(!text.includes(value),value);
  assert.deepEqual(reportFields({location:'private.site',operation:'private-token',version:'https://site',build:'C:\\Users\\x',durationMs:Infinity,ok:'true',reason:'secret',profileCount:1e30}),{});
  assert.deepEqual(reportFields(JSON.parse('{"constructor":"private","__proto__":{"password":"secret"},"route":{"location":"DEU","protocol":"NaiveProxy","server":"private.example"}}')),{location:'DEU',protocol:'NaiveProxy'});
});
test('UTF-8 payload is bounded and retains newest records across all files',async t=>{
  const {logger,write}=await fixture(t);
  for(let i=0;i<5;i++)await write(i?`diagnostics.${i}.jsonl`:'diagnostics.jsonl',Array.from({length:1200},(_,j)=>record(i*1200+j,{durationMs:i*1200+j,latency:55,ok:true})));
  const report=await createIssueReport(logger,metadata,{now,reportId:id});
  assert(Buffer.byteLength(JSON.stringify(report))<=REPORT_BYTES);assert(report.records.length>0&&report.records.length<6000);
  assert.equal(report.records.at(-1).time,new Date(now).toISOString());
  assert.equal(report.records[0].data.durationMs,report.records.length-1);
});
test('backend record cap keeps exactly the newest 1000 when 1200 records fit the byte budget',async t=>{
  const {logger,write}=await fixture(t);
  const rows=Array.from({length:1200},(_,i)=>record(i));
  assert(Buffer.byteLength(JSON.stringify({reportId:id,created:new Date(now).toISOString(),summary:metadata,records:rows}))<REPORT_BYTES);
  await write('diagnostics.jsonl',rows.slice(0,600));await write('diagnostics.1.jsonl',rows.slice(600));
  const report=await createIssueReport(logger,metadata,{now,reportId:id});
  assert.equal(REPORT_RECORDS,1000);assert.equal(report.records.length,1000);
  assert.equal(report.records[0].time,new Date(now-999).toISOString());assert.equal(report.records.at(-1).time,new Date(now).toISOString());
  assert(report.records.every(row=>/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.time)));
});
test('byte cap remains effective before the record-count cap for dense operational records',async t=>{
  const {logger,write}=await fixture(t);
  const data={...metadata,durationMs:123,delayMs:123,latency:123,attempt:3,retryAttempt:3,failures:3,uploadBytes:12345678,downloadBytes:12345678,connections:123,httpStatus:503,exitCode:1,count:123,operation:'report',transport:'secure-dns',phase:'request',stage:'vpn-reachability',reason:'health',signal:'SIGTERM',stream:'stderr',errorType:'NetworkFailure',errorCode:'ETIMEDOUT',ok:false,admin:true,configRemoved:true,coreStopped:true};
  const rows=Array.from({length:500},(_,i)=>record(i,data));
  assert(Buffer.byteLength(JSON.stringify(rows))>REPORT_BYTES);await write('diagnostics.jsonl',rows);
  const report=await createIssueReport(logger,metadata,{now,reportId:id});
  assert(report.records.length>0&&report.records.length<500);
  assert(Buffer.byteLength(JSON.stringify(report))<=REPORT_BYTES);
  assert.equal(report.records.at(-1).time,new Date(now).toISOString());
});
test('missing, oversized files are safe and only expected log names are collected',async t=>{
  const {logger,write,directory}=await fixture(t);
  await fs.writeFile(path.join(directory,'diagnostics.1.jsonl'),'x'.repeat(2*1024*1024+1));
  await write('unrelated.jsonl',[record(0,{latency:666})]);
  const report=await createIssueReport(logger,metadata,{now});assert.deepEqual(report.records,[]);
});
test('no confirmation and legacy signed-out users cause no upload',async t=>{
  let calls=0;const {account,logger}=await accountFixture(t,async()=>{calls++;});
  await assert.rejects(account.report(logger,metadata),/Подтвердите/);
  account.token=null;
  await assert.rejects(account.report(logger,metadata,{confirmed:true}),/Аккаунт.*Импорт/);
  assert.equal(calls,0);
});
test('double clicks share one request; endpoint fallback and explicit retry preserve the same UUID and body',async t=>{
  const calls=[];let fail=true;
  const {account,logger}=await accountFixture(t,async(url,body,token)=>{
    calls.push({url:String(url),body:JSON.stringify(body),token});
    if(fail)throw Object.assign(Error('offline'),{code:'ETIMEDOUT'});
    return {ok:true,reportId:body.reportId,state:'queued'};
  },{baseUrl:'https://first.invalid',baseUrls:['https://first.invalid','https://second.invalid']});
  const first=account.report(logger,metadata,{confirmed:true,now}),second=account.report(logger,metadata,{confirmed:true,now});
  await assert.rejects(first,/не подтверждён/);await assert.rejects(second,/не подтверждён/);assert.equal(calls.length,2);
  fail=false;const result=await account.report(logger,{...metadata,location:'AMS'},{confirmed:true,now:now+1000});
  assert.equal(result.ok,true);assert.equal(new Set(calls.map(c=>c.body)).size,1);assert(calls.every(c=>c.token==='t'.repeat(43)&&c.url.endsWith('/v1/session/report')));
  assert.equal(account.pendingReport,null);
});
test('rejected auth/rate limit and malformed acknowledgements never claim success or bypass rejection',async t=>{
  for(const status of [401,403,429]){
    let calls=0;const {account,logger}=await accountFixture(t,async()=>{calls++;throw Object.assign(Error('denied'),{status});},{baseUrl:'https://first.invalid',baseUrls:['https://first.invalid','https://second.invalid']});
    await assert.rejects(account.report(logger,metadata,{confirmed:true,now}),status===429?/Подождите/:/Сессия/);assert.equal(calls,1);
  }
  for(const reply of [{ok:true,reportId:id,state:'queued'},{ok:true,state:'sent'},{ok:'true',state:'sent'},{ok:true,state:'delivered'}]){
    const {account,logger}=await accountFixture(t,async()=>reply);
    await assert.rejects(account.report(logger,metadata,{confirmed:true,now}),/не подтверждён/);
  }
});
test('expired pending report and changed account get fresh IDs; upload failures do not disable logging',async t=>{
  const ids=[];const {account,logger,directory}=await accountFixture(t,async(url,body)=>{ids.push(body.reportId);throw Error('offline');});
  for(const time of [now,now+REPORT_WINDOW_MS+1])await assert.rejects(account.report(logger,metadata,{confirmed:true,now:time}));
  account.token='n'.repeat(43);await assert.rejects(account.report(logger,metadata,{confirmed:true,now:now+REPORT_WINDOW_MS+2}));
  assert.equal(new Set(ids).size,3);logger.write('health.check',{ok:true});logger.flush();assert.equal(logger.available,true);
  assert.match(await fs.readFile(path.join(directory,'diagnostics.jsonl'),'utf8'),/health.check/);
});
test('UI has explicit privacy copy, waits for acknowledgement and guards double send',async()=>{
  assert.match(REPORT_CONSENT,/3 минуты.*аккаунтом.*Пароли.*сайты/);assert(!REPORT_ACCEPTED.includes('доставлен'));
  let complete,calls=0;const issue=createIssueFlow((command,data)=>{calls++;assert.equal(command,'markIssue');assert.equal(data.confirmed,true);return new Promise(resolve=>complete=resolve);});
  assert.equal(calls,0);const flight=issue.send();assert.equal(issue.busy,true);assert.equal(await issue.send(),null);assert.equal(calls,1);
  complete({ok:true,reportId:id,state:'queued'});assert.equal((await flight).ok,true);assert.equal(issue.busy,false);
  const invalid=createIssueFlow(async()=>({ok:true}));assert.equal(await invalid.send(),null);assert.match(invalid.error,/не подтверждён/);
});
