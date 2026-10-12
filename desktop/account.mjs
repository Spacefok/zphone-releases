import {createAccountTransport} from './account-http.mjs';
export class Account {
  constructor({config,readToken,writeToken,transport=createAccountTransport()}){Object.assign(this,{config,readToken,writeToken,transport});this.pending=null;this.state={state:config?.baseUrl?'signed_out':'unconfigured'};}
  snapshot(){return {...this.state};}
  async call(route,data={},token){
    const base=new URL(this.config.baseUrl);
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Invalid access service');
    return this.transport(new URL(route,base),data,token);
  }
  async restore(){if(!this.config?.baseUrl)return;this.token=await this.readToken();if(this.token)this.state={state:'authorized'};}
  async begin(){
    if(this.beginFlight)return this.beginFlight;
    this.beginFlight=this.start();
    try{return await this.beginFlight;}finally{this.beginFlight=null;}
  }
  botLink(){
    if(!this.pending||this.pending.expires*1000<=Date.now())throw Error('Заявка истекла. Начните вход заново.');
    return {url:`https://t.me/${this.config.botUsername}?start=login_${this.pending.code}`};
  }
  async start(){
    if(!this.config?.baseUrl||!/^\w{5,32}$/.test(this.config.botUsername||''))throw Error('Вход через бота ещё не настроен.');
    if(this.pending?.expires*1000>Date.now())return this.botLink();
    const value=await this.call('/v1/device/start',{platform:'windows'});
    if(!/^[A-Za-z0-9_-]{32}$/.test(value.code)||!/^[A-Za-z0-9_-]{43}$/.test(value.secret)||!/^\d{6}$/.test(value.number)||!Number.isFinite(value.expires))throw Error('Invalid login response');
    this.pending=value;this.state={state:'pending',number:value.number,expires:value.expires};
    return this.botLink();
  }
  async poll(){
    if(!this.pending)return this.snapshot();
    const value=await this.call('/v1/device/poll',this.pending);
    if(value.state==='approved'){
      const redeemed=await this.call('/v1/device/redeem',this.pending);
      if(!/^[A-Za-z0-9_-]{43}$/.test(redeemed.token))throw Error('Invalid session');
      await this.writeToken(redeemed.token);this.token=redeemed.token;this.pending=null;this.state={state:'authorized'};
    }else if(['rejected','expired','consumed'].includes(value.state)){this.pending=null;this.state={state:value.state==='consumed'?'expired':value.state};}
    return this.snapshot();
  }
  async profiles(){if(!this.token)throw Error('Сначала войдите через бота.');return this.call('/v1/session/profiles',{},this.token);}
  async logout(){
    let remoteRevoked=true;
    try{if(this.token)await this.call('/v1/session/logout',{},this.token);}catch{remoteRevoked=false;}
    await this.writeToken(null);this.token=null;this.pending=null;
    this.state={state:'signed_out',message:remoteRevoked?'':'Вы вышли на этом устройстве. Отзыв сессии на сервере не подтверждён.'};
  }
}
