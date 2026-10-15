import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import {coreConfig,candidates,naiveConfig} from '../shared/profiles.mjs';
import {profileCountry} from '../shared/countries.mjs';

export async function freePort() {
  return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class Engine {
  constructor({binary,directory,onState=()=>{},logger=null,beforeReconnect=async()=>{},retryDelays=[2000,5000,10000,20000,30000],monitorMs=30000}) {this.binary=binary;this.directory=directory;this.onState=onState;this.logger=logger;this.beforeReconnect=beforeReconnect;this.retryDelays=retryDelays;this.monitorMs=monitorMs;this.generation=0;this.child=null;this.state={status:'off'};this.active=null;this.queue=Promise.resolve();this.intent=null;this.retrying=false;}
  log(event,data){this.logger?.write(event,data);}
  update(patch){this.state={...this.state,...patch};this.log('connection.state',this.state);this.onState(this.state);}
  async cleanup(){
    clearInterval(this.monitor);this.monitor=null;const child=this.child;
    if(child?.pid&&child.exitCode===null&&child.signalCode===null){
      this.log('core.stop_requested',{pid:child.pid});
      const ended=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([ended,sleep(2500)]);
      if(child.exitCode===null&&child.signalCode===null)throw Error('Не удалось остановить процесс подключения.');
    }
    if(this.child===child)this.child=null;
    const helper=this.helper;
    if(helper?.pid&&helper.exitCode===null&&helper.signalCode===null){
      const ended=new Promise(r=>helper.once('exit',r));helper.kill();await Promise.race([ended,sleep(2500)]);
      if(helper.exitCode===null&&helper.signalCode===null)throw Error('Не удалось остановить NaiveProxy.');
    }
    this.helper=null;
    if(this.helperConfig){await fs.rm(this.helperConfig,{force:true});this.helperConfig=null;}
    if(this.configPath){await fs.rm(this.configPath,{force:true});this.configPath=null;}
    this.active=null;
    this.log('connection.cleanup',{configRemoved:!this.configPath,coreStopped:!this.child});this.logger?.flush();
  }
  async stop(){this.generation++;this.intent=null;this.cancelWait?.();if(this.state.status!=='off')this.update({status:'disconnecting'});await this.queue.catch(()=>{});await this.cleanup();this.retrying=false;this.update({status:'off',route:null,error:null,port:null,latency:null,retryAttempt:null});}
  async start(profiles,selection,mode='isolated'){
    this.logger?.protectProfiles(profiles);this.log('connection.request',{location:selection.location,protocol:selection.protocol,mode});
    const generation=++this.generation;
    this.cancelWait?.();this.retrying=false;this.intent={profiles:structuredClone(profiles),selection:structuredClone(selection),mode};
    this.update({status:'connecting',error:null});
    const operation=async()=>{
      await this.cleanup();
      const choices=candidates(profiles,selection.location,selection.protocol);
      if(!choices.length)throw Error('Для выбранной локации и протокола нет доступа.');
      const order=choices;
      for(let index=0;index<order.length;index++){
        if(generation!==this.generation)return;
        const p=order[index];
        this.update({status:index?'recovering':'connecting',error:null,route:{location:p.location,protocol:p.protocol,country:profileCountry(p)},mode,port:null,latency:null});
        try{
          await this.launch(p,mode,generation,selection.split);
          if(generation!==this.generation){await this.cleanup();return;}
          this.update({status:'checking'});
          const latency=await this.check();
          if(generation!==this.generation){await this.cleanup();return;}
          this.lastProfile=p.id;this.update({status:'connected',latency,port:this.active.port,retryAttempt:null});
          this.armMonitor(generation);
          return;
        }catch(error){
          this.log('connection.attempt_failed',{location:p.location,protocol:p.protocol,error});
          await this.cleanup();
          if(generation!==this.generation)return;
        }
      }
      if(generation===this.generation)this.update({status:'error',port:null,error:'Не удалось получить ответ через выбранные подключения.'});
    };
    this.queue=this.queue.catch(()=>{}).then(operation).catch(error=>{this.log('connection.error',{error});if(generation===this.generation)this.update({status:'error',error:error.message,port:null});});
    return this.queue;
  }
  armMonitor(generation){
    clearInterval(this.monitor);const active=this.active;let failures=0,checking=false;
    this.monitor=setInterval(async()=>{
      if(checking||generation!==this.generation||active!==this.active||this.retrying)return;checking=true;
      try{const latency=await this.check();if(generation!==this.generation||active!==this.active||this.retrying)return;failures=0;this.update({latency});}
      catch(error){if(generation!==this.generation||active!==this.active||this.retrying)return;this.log('health.failed',{failures:++failures,error});if(failures>=2)void this.recover('health',generation);}
      finally{checking=false;}
    },this.monitorMs);
  }
  waitRetry(ms){
    return new Promise(resolve=>{const finish=()=>{clearTimeout(timer);if(this.cancelWait===finish)this.cancelWait=null;resolve();};const timer=setTimeout(finish,ms);this.cancelWait=finish;});
  }
  recover(reason,generation=this.generation){
    if(generation!==this.generation||!this.intent||this.retrying||this.state.status!=='connected')return this.queue;
    const intent=this.intent;this.retrying=true;clearInterval(this.monitor);
    this.log('recovery.request',{reason});this.update({status:'recovering',port:null,error:null,retryAttempt:0});
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      await this.cleanup();
      const choices=candidates(intent.profiles,intent.selection.location,intent.selection.protocol);
      choices.sort((a,b)=>Number(b.id===this.lastProfile)-Number(a.id===this.lastProfile));
      let preflightError=null;
      attempts: for(let attempt=0;attempt<this.retryDelays.length;attempt++){
        if(generation!==this.generation)return;
        this.update({retryAttempt:attempt+1});this.log('recovery.wait',{attempt:attempt+1,delayMs:this.retryDelays[attempt]});
        await this.waitRetry(this.retryDelays[attempt]);if(generation!==this.generation)return;
        for(const profile of choices){
          if(generation!==this.generation)return;
          try{await this.beforeReconnect(intent.mode);}catch(error){
            if(generation!==this.generation)return;
            this.log('recovery.preflight_failed',{attempt:attempt+1,error});
            if(error.code==='ADMIN_REQUIRED')throw error;
            // A link outage can temporarily select an auxiliary VPN route.
            // Wait for the guard to pass; never launch through a conflict.
            preflightError=error;continue attempts;
          }
          if(generation!==this.generation)return;
          preflightError=null;
          this.update({route:{location:profile.location,protocol:profile.protocol,country:profileCountry(profile)}});
          try{
            await this.launch(profile,intent.mode,generation,intent.selection.split);
            if(generation!==this.generation){await this.cleanup();return;}
            const latency=await this.check();
            if(generation!==this.generation){await this.cleanup();return;}
            this.lastProfile=profile.id;this.retrying=false;
            this.log('recovery.success',{attempt:attempt+1,location:profile.location,protocol:profile.protocol});
            this.update({status:'connected',latency,port:this.active.port,error:null,retryAttempt:null});this.armMonitor(generation);return;
          }catch(error){this.log('recovery.attempt_failed',{attempt:attempt+1,error});await this.cleanup();}
        }
      }
      if(generation===this.generation)throw preflightError||Error('Не удалось восстановить соединение после пяти попыток. Повторите подключение.');
    }).catch(async error=>{
      this.log('recovery.failed',{error});try{await this.cleanup();}catch(cleanupError){this.log('recovery.cleanup_failed',{error:cleanupError});}
      if(generation===this.generation)this.update({status:'error',port:null,error:error.message,retryAttempt:null});
    }).finally(()=>{if(generation===this.generation)this.retrying=false;});
    return this.queue;
  }
  async launch(profile,mode,generation,split){
    this.logger?.protectProfiles([profile]);
    const port=await freePort(),apiPort=await freePort(),secret=crypto.randomBytes(24).toString('hex');
    await fs.mkdir(this.directory,{recursive:true});
    this.configPath=path.join(this.directory,'session.json');
    this.logger?.protect(secret);
    const naivePort=profile.protocol==='NaiveProxy'?await this.launchNaive(profile,generation):undefined;
    const config=coreConfig(profile,{port,apiPort,secret,mode,naivePort,split});if(this.logger)config['log-level']='debug';
    await fs.writeFile(this.configPath,JSON.stringify(config),{mode:0o600});
    this.active={port,apiPort,secret};
    const child=spawn(this.binary,['-d',this.directory,'-f',this.configPath],{windowsHide:true,stdio:this.logger?['ignore','pipe','pipe']:'ignore'});this.child=child;
    this.logger?.attach(child.stdout,'stdout');this.logger?.attach(child.stderr,'stderr');this.log('core.spawn',{pid:child.pid,mode});
    let spawnError=false;child.on('error',error=>{spawnError=true;this.log('core.spawn_error',{error});});
    child.on('exit',(code,signal)=>{
      this.log('core.exit',{pid:child.pid,code,signal});
      if(this.child===child&&this.state.status==='connected')void this.recover('core.exit',generation);
    });
    for(let i=0;i<60;i++){
      if(generation!==this.generation)throw Error('Cancelled');
      if(spawnError||child.exitCode!==null||child.signalCode!==null)throw Error('Core unavailable');
      try{await this.api('/proxies/Zphone-Test',1500);return;}catch{await sleep(100);}
    }
    throw Error('Core start timeout');
  }
  async launchNaive(profile,generation){
    const port=await freePort();
    this.helperConfig=path.join(this.directory,'naive.json');
    await fs.writeFile(this.helperConfig,JSON.stringify(naiveConfig(profile,port)),{mode:0o600});
    const helper=spawn(path.join(path.dirname(this.binary),'naive.exe'),[this.helperConfig],{windowsHide:true,stdio:['ignore','pipe','pipe']});this.helper=helper;
    this.logger?.attach(helper.stdout,'naive.stdout');this.logger?.attach(helper.stderr,'naive.stderr');
    if(!this.logger){helper.stdout.resume();helper.stderr.resume();}
    this.log('naive.spawn',{pid:helper.pid});let failed=false;
    helper.on('error',error=>{failed=true;this.log('naive.spawn_error',{error});});
    helper.on('exit',(code,signal)=>{this.log('naive.exit',{code,signal});if(this.helper===helper&&this.state.status==='connected')void this.recover('naive.exit',generation);});
    for(let i=0;i<60;i++){
      if(generation!==this.generation)throw Error('Cancelled');
      if(failed||helper.exitCode!==null||helper.signalCode!==null)throw Error('NaiveProxy unavailable');
      const ready=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});const done=value=>{socket.destroy();resolve(value);};socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.setTimeout(300,()=>done(false));});
      if(ready)return port;await sleep(100);
    }
    throw Error('NaiveProxy start timeout');
  }
  async api(route,timeout=12000){
    if(!this.active)throw Error('No connection');
    const {apiPort,secret}=this.active;
    const response=await fetch(`http://127.0.0.1:${apiPort}${route}`,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(timeout)});
    if(!response.ok){const detail=(await response.text()).slice(0,2048);this.log('core.api_error',{route:route.split('?')[0],status:response.status,detail});throw Error('Network check failed');}return response.json();
  }
  async check(){
    const result=await this.api('/proxies/Zphone-Test/delay?timeout=8000&url='+encodeURIComponent('https://www.gstatic.com/generate_204'),10000);
    if(!Number.isFinite(result.delay)||result.delay<0)throw Error('Invalid check');this.log('health.proxy_ok',{latency:result.delay});return result.delay;
  }
}
