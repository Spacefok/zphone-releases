import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {validateBundle} from '../shared/profiles.mjs';

// Stage beside the vault. Never unlink the old vault to make a rename succeed.
export async function prepareVault(vault,bytes,io=fs){
  const temporary=vault+'.'+randomUUID()+'.tmp';
  let file;
  try{
    file=await io.open(temporary,'wx',0o600);
    await file.writeFile(bytes);await file.sync();await file.close();file=null;
  }catch(error){await file?.close().catch(()=>{});await io.rm(temporary,{force:true}).catch(()=>{});throw error;}
  return {commit:()=>io.rename(temporary,vault),discard:()=>io.rm(temporary,{force:true})};
}

export class ProfileRefresh {
  constructor({version,account,marker=null,isIdle,isOnline=()=>true,prepare,apply,notify=()=>{},logger=null,
    now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,retryDelays=[30000,120000,300000]}){
    Object.assign(this,{version,account,isIdle,isOnline,prepare,apply,notify,logger,now,setTimer,clearTimer,retryDelays});
    this.marker=marker;this.state={state:'idle'};this.epoch=0;this.session=null;this.attempt=0;this.nextAt=0;
    this.holds=0;this.connecting=0;this.queue=Promise.resolve();this.stopped=false;this.blocked=false;
  }
  snapshot(){return {...this.state};}
  sessionHash(){
    const token=this.account.token;
    if(this.account.snapshot().state!=='authorized'||typeof token!=='string'||!(/^[A-Za-z0-9_-]{43}$/).test(token))return null;
    return createHash('sha256').update('zphone-profile-refresh\0'+token).digest('hex');
  }
  satisfied(){return this.session&&this.marker?.version===this.version&&this.marker.sessionHash===this.session&&['server','import'].includes(this.marker.source)&&Number.isFinite(this.marker.checkedAt)&&this.marker.checkedAt>=0;}
  settledState(){return !this.session?'idle':this.blocked?'sign_in':this.satisfied()?(this.marker.source==='server'?'current':'idle'):'pending';}
  setState(state,checkedAt){
    const next={state,...(checkedAt!==undefined?{checkedAt}:{})};
    if(JSON.stringify(next)===JSON.stringify(this.state))return;
    this.state=next;this.notify();
  }
  cancelTimer(){if(this.timer!==undefined)this.clearTimer(this.timer);this.timer=undefined;}
  invalidate(){this.epoch++;this.cancelTimer();}
  syncSession(){
    const session=this.sessionHash();
    if(session!==this.session){
      this.invalidate();this.session=session;this.attempt=0;this.nextAt=0;this.blocked=false;
      this.setState(this.settledState(),this.satisfied()&&this.marker.source==='server'?this.marker.checkedAt:undefined);
    }
  }
  valid(epoch,session){return !this.stopped&&epoch===this.epoch&&session===this.sessionHash();}
  available(){return this.connecting===0&&this.isIdle();}
  exclusive(action){const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;}
  log(status,fields={}){this.logger?.write('access.sync',{version:this.version,status,...fields});}
  retry(code,statusCode){
    this.setState('retry');this.log('retry',{code,...(statusCode?{statusCode}:{})});this.cancelTimer();
    const delay=this.retryDelays[Math.min(this.attempt,this.retryDelays.length-1)]??300000;
    this.nextAt=this.now()+delay;
    if(this.attempt<this.retryDelays.length){
      this.attempt++;
      this.timer=this.setTimer(()=>{this.timer=undefined;void this.wake();},delay);this.timer?.unref?.();
    }
  }
  wake(){return this.refresh();}
  refresh({manual=false}={}){
    const result=flight=>manual?flight.then(value=>{
      if(value.applied)return this.snapshot();
      const code=value.state==='sign_in'||!this.session?'PROFILE_SYNC_SIGN_IN':value.state==='deferred'?'PROFILE_SYNC_DEFERRED':'PROFILE_SYNC_FAILED';
      const message=code==='PROFILE_SYNC_SIGN_IN'?'Для обновления подключений войдите в аккаунт заново.':code==='PROFILE_SYNC_DEFERRED'?'Сначала отключите соединение, затем повторите обновление подключений.':'Не удалось обновить подключения. Сохранённые ключи не изменены. Повторите попытку позже.';
      throw Object.assign(Error(message),{code});
    }):flight;
    if(this.stopped)return result(Promise.resolve(this.snapshot()));
    this.syncSession();
    if(this.holds||!this.session)return result(Promise.resolve(this.snapshot()));
    if(this.blocked){this.setState('sign_in');return result(Promise.resolve(this.snapshot()));}
    if(this.flight)return result(this.flight);
    if(!manual&&this.satisfied()){this.setState(this.settledState(),this.marker.source==='server'?this.marker.checkedAt:undefined);return Promise.resolve(this.snapshot());}
    if(!this.available()){this.setState('deferred');return result(Promise.resolve(this.snapshot()));}
    if(!manual&&this.now()<this.nextAt){
      if(this.state.state==='deferred'&&this.timer===undefined){this.timer=this.setTimer(()=>{this.timer=undefined;void this.wake();},this.nextAt-this.now());this.timer?.unref?.();}
      return Promise.resolve(this.snapshot());
    }
    this.cancelTimer();
    const epoch=this.epoch,session=this.session;
    const flight=Promise.resolve().then(()=>this.fetch(epoch,session)).finally(()=>{
      if(this.flight===flight)this.flight=null;
      if(!this.stopped&&!this.holds){
        this.syncSession();
        if(epoch!==this.epoch)void this.wake();
      }
    });
    this.flight=flight;return result(flight);
  }
  async fetch(epoch,session){
    let staged,applied=false,phase='transport';
    try{
      if(!this.valid(epoch,session)||this.holds)return this.snapshot();
      if(!this.available()){this.setState('deferred');return this.snapshot();}
      if(!this.isOnline()){this.retry('OFFLINE');return this.snapshot();}
      this.nextAt=this.now()+(this.retryDelays[0]??30000);this.setState('refreshing');
      const response=await this.account.profiles();
      if(!this.valid(epoch,session)||this.holds)return this.snapshot();
      phase='validation';
      if(response?.state!=='ready'){
        this.retry(['pending','preparing','not_ready'].includes(response?.state)?'NOT_READY':'INVALID_RESPONSE');return this.snapshot();
      }
      const bundle=validateBundle(response.bundle);
      if(!this.available()){this.setState('deferred');return this.snapshot();}
      const marker={version:this.version,sessionHash:session,checkedAt:this.now(),source:'server'};
      phase='storage';staged=await this.prepare(bundle,marker);
      await this.exclusive(async()=>{
        if(!this.valid(epoch,session)||this.holds)return;
        if(!this.available()){this.setState('deferred');return;}
        // Session mutations and connect reservations use this same short commit gate.
        await staged.commit();this.marker=marker;this.apply(bundle);applied=true;
        this.attempt=0;this.nextAt=0;this.setState('current',marker.checkedAt);this.log('current',{count:bundle.profiles.length});
      });
    }catch(error){
      if(this.valid(epoch,session)&&!this.holds){
        const statusCode=Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:undefined;
        if(phase==='transport'&&(statusCode===401||statusCode===403)){
          this.cancelTimer();this.blocked=true;this.setState('sign_in');this.log('sign_in',{statusCode});
        }else this.retry(phase==='validation'?'INVALID_BUNDLE':phase==='storage'?'WRITE_FAILED':'TRANSPORT',statusCode);
      }
    }finally{await staged?.discard().catch(()=>{});}
    return {...this.snapshot(),applied};
  }
  async sessionChange(action){
    this.holds++;
    try{
      await this.exclusive(()=>this.invalidate());
      if(this.stopped)return this.snapshot();
      return await action();
    }finally{this.holds--;if(!this.stopped){this.syncSession();if(!this.holds)void this.wake();}}
  }
  async importProfiles(load){
    this.holds++;let staged,applied=false;
    try{
      const epoch=await this.exclusive(()=>{this.invalidate();this.syncSession();return this.epoch;});
      const session=this.session;
      if(this.stopped)throw Error('Profile refresh stopped');
      const value=await load();if(value===null)return;
      const bundle=validateBundle(value);
      const marker=session&&!this.blocked?{version:this.version,sessionHash:session,checkedAt:this.now(),source:'import'}:null;
      staged=await this.prepare(bundle,marker);
      await this.exclusive(async()=>{
        if(!this.valid(epoch,session)||this.holds!==1)throw Error('Profile operation superseded');
        if(!this.available())throw Error('Disconnect before importing profiles');
        await staged.commit();this.marker=marker;this.apply(bundle);applied=true;this.attempt=0;this.nextAt=0;
        this.setState(this.blocked?'sign_in':'idle');this.log('imported',{count:bundle.profiles.length});
      });
    }finally{
      await staged?.discard().catch(()=>{});this.holds--;
      if(!applied&&!this.stopped){this.syncSession();this.setState(this.settledState(),this.satisfied()&&this.marker.source==='server'?this.marker.checkedAt:undefined);}
    }
  }
  async connect(action){
    this.connecting++;
    try{return await this.exclusive(()=>{if(this.stopped)throw Error('Profile refresh stopped');return action();});}
    finally{this.connecting--;if(!this.stopped&&this.state.state==='deferred'&&this.available())void this.wake();}
  }
  shutdown(){this.stopped=true;this.invalidate();return this.exclusive(()=>{});}
}
