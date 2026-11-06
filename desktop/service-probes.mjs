import dns from 'node:dns';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export const PROBE_HOSTS=Object.freeze(['www.google.com','gemini.google.com','www.youtube.com','www.amazon.com','music.youtube.com','discord.com','gateway.discord.gg']);
const timeoutError=()=>Object.assign(Error('Probe timeout'),{code:'ETIMEDOUT'});
export function deadline(promise,ms,signal){
  let timer,abort;
  return Promise.race([promise,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(timeoutError()),ms);abort=()=>reject(Object.assign(Error('Cancelled'),{code:'ABORT_ERR'}));
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  })]).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);});
}
export function dnsCounts(addresses){return {count:addresses.filter(a=>a.family===4).length,records:addresses.filter(a=>a.family===6).length};}
async function systemDns(host){return dnsCounts(await deadline(new Promise((resolve,reject)=>dns.lookup(host,{all:true},(error,value)=>error?reject(error):resolve(value))),4500));}
export async function proxyDns(engine,host,active=engine.active){
  let count=0,records=0;
  for(const type of ['A','AAAA']){
    const answer=await engine.api('/dns/query?name='+encodeURIComponent(host)+'&type='+type,4500,active);
    if(Number(answer.Status)!==0)throw Object.assign(Error('DNS failure'),{code:'DNS_ERROR'});
    const n=(answer.Answer||[]).filter(row=>row.type===(type==='A'?1:28)).length;
    if(type==='A')count=n;else records=n;
  }
  return {count,records};
}
export function curlArguments(host,port){
  if(!PROBE_HOSTS.includes(host)||port!==undefined&&(!Number.isInteger(port)||port<1||port>65535))throw Error('Invalid probe');
  return ['--disable','--silent','--head','--http1.1','--connect-timeout','3','--max-time','5','--max-filesize','65536',
    '--proxy',port===undefined?'':`http://127.0.0.1:${port}`,'--noproxy',port===undefined?'*':'',
    '--output','NUL','--write-out','%{json}',`https://${host}/`];
}
async function httpsProbe(host,port,{signal}={}){
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe');
  let result;
  try{result=await run(exe,curlArguments(host,port),{windowsHide:true,timeout:6500,maxBuffer:65536,signal});}
  catch(error){
    const code=({5:'DNS_ERROR',6:'DNS_ERROR',7:'CONNECT_FAILED',28:'ETIMEDOUT',35:'TLS_ERROR',60:'TLS_ERROR'})[error.code]||'NETWORK_ERROR';
    throw Object.assign(Error('Probe failed'),{code});
  }
  const data=JSON.parse(result.stdout),httpStatus=Number(data.http_code);
  if(!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599)throw Object.assign(Error('No HTTP response'),{code:'HTTP_ERROR'});
  return {httpStatus};
}
export async function collectServiceProbes({engine,logger,network=async()=>({networkType:'unknown'}),lookup=systemDns,request=httpsProbe,signal}){
  const state=engine.state,active=engine.active,generation=engine.generation,port=state.status==='connected'?state.port:null;
  const route={location:state.route?.location,protocol:state.route?.protocol};
  const valid=()=>!signal?.aborted&&engine.active===active&&engine.generation===generation&&engine.state.status==='connected'&&engine.state.port===port;
  if(!port){logger.write('health.check',{stage:'probe',ok:false,reason:'unavailable'});return;}
  try{logger.write('network.snapshot',{stage:'probe',...route,...await deadline(network(),5000,signal)});}catch{logger.write('network.snapshot_failed',{stage:'probe',...route});}
  if(!valid())return;
  const sample=async(attempt,transport,phase,probe)=>{
    const start=Date.now();let facts;
    try{if(!valid())throw Error('Connection changed');facts={ok:true,...await deadline(probe(),10000,signal)};}catch(error){facts={ok:false,errorCode:error.code||'NETWORK_ERROR'};}
    if(!valid())facts={ok:false,reason:'cancelled'};
    logger.write('health.check',{stage:'probe',...route,attempt,transport,phase,durationMs:Date.now()-start,...facts});
  };
  await Promise.all(PROBE_HOSTS.map(async(host,index)=>{
    // Ordinals identify fixed test targets without permitting arbitrary hosts in reports.
    await Promise.all([
      sample(index+1,'system','resolve',()=>lookup(host)),
      sample(index+1,'proxy','resolve',()=>proxyDns(engine,host,active)),
      sample(index+1,'system','request',()=>request(host,undefined,{signal})),
      sample(index+1,'proxy','request',()=>request(host,port,{signal})),
    ]);
  }));
  logger.flush?.();
}

export class ServiceProbeMonitor {
  constructor({engine,collect,intervalMs=60000,initialMs=1000}){Object.assign(this,{engine,collect,intervalMs,initialMs});this.active=null;this.flight=null;this.timer=null;}
  stateChanged(){
    if(this.engine.state.status!=='connected'){clearTimeout(this.timer);this.timer=null;this.active=null;this.controller?.abort();return;}
    if(this.active===this.engine.active)return;
    this.controller?.abort();this.active=this.engine.active;clearTimeout(this.timer);
    this.schedule(this.initialMs);
  }
  schedule(ms){this.timer=setTimeout(()=>{this.timer=null;void this.capture();},ms);this.timer.unref?.();}
  capture(){
    if(this.flight)return this.flight;
    clearTimeout(this.timer);this.timer=null;
    this.controller=new AbortController();
    this.flight=Promise.resolve().then(()=>this.collect(this.controller.signal)).catch(()=>{}).finally(()=>{
      this.flight=null;
      if(this.active&&this.engine.state.status==='connected')this.schedule(this.intervalMs);
    });
    return this.flight;
  }
  close(){clearTimeout(this.timer);this.timer=null;this.active=null;this.controller?.abort();}
}
