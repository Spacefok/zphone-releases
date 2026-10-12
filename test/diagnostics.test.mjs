import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PassThrough} from 'node:stream';
import {Diagnostics} from '../desktop/diagnostics.mjs';
import {Engine} from '../desktop/engine.mjs';

async function fixture(t,options){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-logs-'));
  const logger=new Diagnostics(directory,options);
  t.after(async()=>{logger.flush();await fs.rm(directory,{recursive:true,force:true});});
  return {directory,logger,read:()=>fs.readFile(path.join(directory,'diagnostics.jsonl'),'utf8')};
}
test('diagnostics mask credentials, URL paths, and ordinary hostnames',async t=>{
  const {logger,read}=await fixture(t);
  const profile={username:'private-user',password:'secret+/value',server:'203.0.113.18',sni:'private-endpoint.test',fingerprint:'a'.repeat(64)};
  logger.protectProfiles([profile]);logger.protect('api-secret-value');
  logger.write('test',{message:`${JSON.stringify(profile)} api-secret-value ${encodeURIComponent(profile.password)} ${Buffer.from(profile.username+':'+profile.password).toString('base64')} https://reader:unknown@visited.example/private-page?token=other 198.51.100.15 [2001:db8::9] via 2001:db8::8 and fe80::1234%7`,password:'not-yet-registered',dns:'1.1.1.1'});logger.flush();
  const text=await read();const record=JSON.parse(text);
  for(const value of [...Object.values(profile),'api-secret-value','not-yet-registered','visited.example','private-page','198.51.100.15','2001:db8::9','2001:db8::8','fe80::1234','reader:unknown'])assert(!text.includes(value),value);
  assert.equal(record.data.dns,'1.1.1.1');assert(text.includes('host#'));assert(record.time.endsWith('Z'));
});
test('secrets split across output chunks are still redacted',async t=>{
  const {logger,read}=await fixture(t);logger.protect('split-secret-key');
  const stream=new PassThrough();logger.attach(stream,'stderr');
  stream.write(Buffer.from('failure split-se'));stream.end(Buffer.from('cret-key\n'));
  await new Promise(r=>stream.once('end',r));logger.flush();
  const text=await read();assert(!text.includes('split-se'));assert(text.includes('[redacted]'));
});
test('oversized core lines are discarded, not partially disclosed',async t=>{
  const {logger,read}=await fixture(t);const stream=new PassThrough();logger.attach(stream,'stdout');
  stream.end('x'.repeat(17000)+'private-suffix\nnormal\n');await new Promise(r=>stream.once('end',r));logger.flush();
  const text=await read();assert(!text.includes('private-suffix'));assert(text.includes('core.line_dropped'));assert(text.includes('normal'));
});
test('rotation keeps only the bounded recent files',async t=>{
  const {logger,directory}=await fixture(t,{maxBytes:350,maxFiles:3});
  for(let i=0;i<12;i++){logger.write('test',{i,message:'x'.repeat(100)});logger.flush();}
  const files=await fs.readdir(directory);assert.equal(files.length,3);
  for(const file of files)for(const line of (await fs.readFile(path.join(directory,file),'utf8')).trim().split('\n'))assert.doesNotThrow(()=>JSON.parse(line));
});
test('disk failures do not throw through the networking code',async t=>{
  const {directory}=await fixture(t);const blocked=path.join(directory,'file');await fs.writeFile(blocked,'not a directory');
  const logger=new Diagnostics(blocked);assert.doesNotThrow(()=>{logger.write('failed',{message:'test'});logger.flush();});assert.equal(logger.available,false);
});
test('engine failures retain useful error detail without test secrets',async t=>{
  const {logger,read}=await fixture(t);
  class FailingEngine extends Engine {
    async launch(){throw Error('failed for masked-user masked-password');}
  }
  const engine=new FailingEngine({binary:'unused',directory:'unused',logger});
  await engine.start([{id:'test',location:'FIN',protocol:'TrustTunnel',username:'masked-user',password:'masked-password'}],{location:'FIN',protocol:'TrustTunnel'});
  await engine.stop();logger.flush();const text=await read();
  assert(text.includes('connection.attempt_failed'));assert(text.includes('failed for'));
  assert(!text.includes('masked-user'));assert(!text.includes('masked-password'));
});
test('new protocol keys and their IPC encodings never reach the diagnostic file',async t=>{
  const {logger,read}=await fixture(t);
  const privateKey=Buffer.alloc(32,17).toString('base64'),header=Buffer.alloc(32,27).toString('base64');
  const profile={privateKey,presharedKey:Buffer.alloc(32,37).toString('base64'),obfsPassword:'salamander-secret-test',awg:{'header-protection-key':header}};
  logger.protectProfiles([profile]);logger.write('test',{profile,message:`private_key=${Buffer.from(privateKey,'base64').toString('hex')} ${header} ${profile.obfsPassword}`});logger.flush();
  const text=await read();for(const secret of [privateKey,header,profile.presharedKey,profile.obfsPassword,Buffer.from(privateKey,'base64').toString('hex')])assert(!text.includes(secret));
});
