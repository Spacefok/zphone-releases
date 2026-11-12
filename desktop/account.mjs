import {createAccountTransport} from './account-http.mjs';
import {accessEndpoints,canRetryAccess} from '../shared/account-policy.mjs';
import {createIssueReport,REPORT_BYTES,REPORT_WINDOW_MS,reportFailure} from './diagnostics-report.mjs';
import {withDeadline} from '../shared/async-deadline.mjs';
export class Account {
  constructor({config,readToken,writeToken,transport=createAccountTransport(),collectDiagnostics=async()=>{},reportTimeoutMs=40000,diagnosticsTimeoutMs=8000}){Object.assign(this,{config,readToken,writeToken,transport,collectDiagnostics,reportTimeoutMs,diagnosticsTimeoutMs});this.pending=null;this.state={state:config?.baseUrl?'signed_out':'unconfigured'};}
  snapshot(){return {...this.state};}
  async call(route,data={},token,{signal}={}){
    const endpoints=accessEndpoints(this.config);
    if(this.preferred)endpoints.sort((a,b)=>Number(b===this.preferred)-Number(a===this.preferred));
    for(let index=0;index<endpoints.length;index++){
      signal?.throwIfAborted();
      try{
        const value=await this.transport(new URL(route,endpoints[index]),data,token,{signal});
        signal?.throwIfAborted();
        this.preferred=endpoints[index];return value;
      }catch(error){if(index===endpoints.length-1||!canRetryAccess(route,error))throw error;}
    }
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
    const proof=this.token?this.recoveryProof?.():undefined;
    const value=await this.call('/v1/device/start',{platform:'windows',...(proof?{recoveryProof:proof}:{})});
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
  clearReport(){clearTimeout(this.reportExpiry);this.pendingReport=null;}
  async report(logger,metadata,{confirmed=false,now}={}){
    if(confirmed!==true)throw Error('Подтвердите отправку отчёта.');
    if(!this.token)throw Error('Для отправки сбоя откройте «Аккаунт» и войдите через бота. Импорт файла не выполняет вход.');
    if(this.reportFlight)return this.reportFlight;
    this.reportFlight=withDeadline(signal=>this.sendReport(logger,metadata,now,signal),this.reportTimeoutMs);
    try{return await this.reportFlight;}catch(error){throw reportFailure(error);}finally{this.reportFlight=null;}
  }
  async sendReport(logger,metadata,now,signal){
    const token=this.token;
    logger.write('user.mark',metadata);
    const liveTime=now===undefined;
    now??=Date.now();
    try{
      if(!this.pendingReport||this.pendingReport.token!==token||now-this.pendingReport.time>REPORT_WINDOW_MS||now<this.pendingReport.time){
        this.clearReport();
        try{await withDeadline(()=>this.collectDiagnostics(),this.diagnosticsTimeoutMs,signal);}catch{logger.write('network.snapshot_failed',{stage:'probe'});}
        signal?.throwIfAborted();
        if(liveTime)now=Date.now();
        const body=await createIssueReport(logger,metadata,{now});
        signal?.throwIfAborted();
        this.pendingReport={token,time:now,body};
        const pending=this.pendingReport;
        this.reportExpiry=setTimeout(()=>{if(this.pendingReport===pending)this.clearReport();},REPORT_WINDOW_MS);this.reportExpiry.unref();
      }
      const body=this.pendingReport.body;
      signal?.throwIfAborted();
      if(this.token!==token)throw Object.assign(Error('Session changed'),{status:401});
      if(Buffer.byteLength(JSON.stringify(body))>REPORT_BYTES)throw Error('Report too large');
      const result=await this.call('/v1/session/report',body,token,{signal});
      if(result?.ok!==true||result.reportId!==body.reportId||!['queued','sent'].includes(result.state))throw Error('Invalid report acknowledgement');
      this.clearReport();logger.write('report.accepted',{ok:true});
      return {ok:true,reportId:result.reportId,state:result.state};
    }catch(error){
      if(error.status===401||error.status===403)this.clearReport();
      logger.write('report.failed',{status:error.status,code:error.code});throw reportFailure(error);
    }finally{logger.flush();}
  }
  async logout(){
    this.clearReport();
    let remoteRevoked=true;
    try{if(this.token)await this.call('/v1/session/logout',{},this.token);}catch{remoteRevoked=false;}
    await this.writeToken(null);this.token=null;this.pending=null;
    this.state={state:'signed_out',message:remoteRevoked?'':'Вы вышли на этом устройстве. Отзыв сессии на сервере не подтверждён.'};
  }
}
