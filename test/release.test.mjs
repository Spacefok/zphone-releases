import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {verifyRelease,verifyArtifact,readJson} from '../shared/release.mjs';
import {Updates} from '../desktop/updates.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const keys=generateKeyPairSync('rsa',{modulusLength:3072});
const config={repository:'example/releases',channel:'test',publicKey:keys.publicKey.export({type:'spki',format:'pem'})};
const bytes=Buffer.from('test artifact');
const asset={url:'https://github.com/example/releases/releases/download/v1.0.1/setup.exe',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sha512:createHash('sha512').update(bytes).digest('base64')};
const release={format:'zphone-release-v1',channel:'test',version:'1.0.1',published:new Date(Date.now()-1000).toISOString(),expires:new Date(Date.now()+600000).toISOString(),notes:'Test release',assets:{'windows-x64':asset}};
function signed(value=release){const payload=Buffer.from(JSON.stringify(value));return {payload:payload.toString('base64'),signature:sign('RSA-SHA256',payload,keys.privateKey).toString('base64')};}
test('release accepts only pinned signed metadata and correct artifacts',()=>{assert.equal(verifyRelease(signed(),config).version,'1.0.1');verifyArtifact(bytes,asset);assert.throws(()=>verifyArtifact(Buffer.from('tampered'),asset));});
test('reject tampering, foreign repository, wrong channel and expired release',()=>{
  const envelope=signed();envelope.payload=Buffer.from(JSON.stringify({...release,version:'9.0.0'})).toString('base64');assert.throws(()=>verifyRelease(envelope,config));
  for(const change of [{channel:'stable'},{expires:new Date(0).toISOString()},{assets:{'windows-x64':{...asset,url:'https://github.com/foreign/releases/releases/download/v1/file'}}}])assert.throws(()=>verifyRelease(signed({...release,...change}),config));
});
test('bounded JSON response rejects oversized metadata and HTTP failures',async()=>{await assert.rejects(readJson(new Response('a'.repeat(50)),10));await assert.rejects(readJson(new Response('{}',{status:403})));});
test('unconfigured updates do not fetch, install or quit',async()=>{const updater=new Updates({config:{publicKey:null},version:'1.0.0',installed:false});assert.equal((await updater.check()).state,'unconfigured');await assert.rejects(updater.install());});
test('install refuses active VPN, portable builds and a changed cached file',async()=>{
  const updater=new Updates({config,version:'1.0.0',installed:true});let installs=0;
  updater.state={state:'ready'};updater.file='fake';updater.updater={quitAndInstall:()=>installs++};updater.verifyFile=async()=>{throw Error('changed');};
  await assert.rejects(updater.install({busy:true}),/VPN/);await assert.rejects(updater.install(),/changed/);updater.installed=false;await assert.rejects(updater.install());assert.equal(installs,0);
});
test('install performs verification before explicit updater launch',async()=>{const updater=new Updates({config,version:'1.0.0',installed:true});const calls=[];updater.state={state:'ready'};updater.file='test';updater.verifyFile=async()=>calls.push('verify');updater.updater={quitAndInstall:()=>calls.push('install')};await updater.install();assert.deepEqual(calls,['verify','install']);});
test('VPN started during verification blocks installation too',async()=>{const updater=new Updates({config,version:'1.0.0',installed:true});let busy=false;updater.state={state:'ready'};updater.file='test';updater.verifyFile=async()=>{busy=true;};updater.updater={quitAndInstall:()=>assert.fail('must not install')};await assert.rejects(updater.install({isBusy:()=>busy}),/VPN/);});

test('a concurrent check cannot clear installation state',async()=>{const updater=new Updates({config,version:'1.0.0',installed:true});updater.state={state:'installing'};updater.init=()=>assert.fail('must not check');assert.equal((await updater.check()).state,'installing');});

test('release rejects nonstandard download ports',()=>{assert.throws(()=>verifyRelease(signed({...release,assets:{'windows-x64':{...asset,url:asset.url.replace('github.com','github.com:8443')}}}),config));});
test('real NSIS provider verifies a signed test download without touching installed apps',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-update-test-')),oldFetch=globalThis.fetch;
  try{
    await fs.writeFile(path.join(dir,'update.yml'),'updaterCacheDirName: isolated-test\n');
    globalThis.fetch=async()=>new Response(JSON.stringify(signed()));
    const require=createRequire(import.meta.url),{NsisUpdater}=require('electron-updater');
    const app={version:'1.0.0',name:'isolated-test',isPackaged:true,appUpdateConfigPath:path.join(dir,'update.yml'),userDataPath:dir,baseCachePath:dir,whenReady:async()=>{},relaunch:()=>assert.fail('relaunch'),quit:()=>assert.fail('quit'),onQuit:()=>assert.fail('auto-install hook')};
    const updater=new Updates({config,version:'1.0.0',installed:true,makeUpdater:options=>{
      const native=new NsisUpdater(null,app);native.httpExecutor={download:async(_url,file)=>fs.writeFile(file,bytes)};native.setFeedURL(options);return native;
    }});
    assert.equal((await updater.check()).state,'available');assert.equal(updater.updater.autoInstallOnAppQuit,false);
    assert.equal((await updater.download()).state,'ready');await fs.writeFile(updater.file,'tampered');await assert.rejects(updater.verifyFile());
  }finally{globalThis.fetch=oldFetch;assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zphone-update-test-'));await fs.rm(dir,{recursive:true,force:true});}
});
