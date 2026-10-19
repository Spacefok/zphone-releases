import dns from 'node:dns';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export const PROBE_HOSTS=Object.freeze(['www.google.com','gemini.google.com','www.youtube.com','www.amazon.com']);
const timeoutError=()=>Object.assign(Error('Probe timeout'),{code:'ETIMEDOUT'});
export function deadline(promise,ms){
  let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeoutError()),ms);})]).finally(()=>clearTimeout(timer));
}
export function dnsCounts(addresses){return {count:addresses.filter(a=>a.family===4).length,records:addresses.filter(a=>a.family===6).length};}
async function systemDns(host){return dnsCounts(await deadline(new Promise((resolve,reject)=>dns.lookup(host,{all:true},(error,value)=>error?reject(error):resolve(value))),4500));}
export async function proxyDns(engine,host){
  let count=0,records=0;
  for(const type of ['A','AAAA']){
    const answer=await engine.api('/dns/query?name='+encodeURIComponent(host)+'&type='+type,4500);
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
async function httpsProbe(host,port){
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe');
  let result;
  try{result=await run(exe,curlArguments(host,port),{windowsHide:true,timeout:6500,maxBuffer:65536});}
  catch(error){
    const code=({5:'DNS_ERROR',6:'DNS_ERROR',7:'CONNECT_FAILED',28:'ETIMEDOUT',35:'TLS_ERROR',60:'TLS_ERROR'})[error.code]||'NETWORK_ERROR';
    throw Object.assign(Error('Probe failed'),{code});
  }
  const data=JSON.parse(result.stdout),httpStatus=Number(data.http_code);
  if(!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599)throw Object.assign(Error('No HTTP response'),{code:'HTTP_ERROR'});
  return {httpStatus};
}
export async function collectServiceProbes({engine,logger,network=async()=>({networkType:'unknown'}),lookup=systemDns,request=httpsProbe}){
  try{logger.write('network.snapshot',{stage:'probe',...await deadline(network(),5000)});}catch{logger.write('network.snapshot_failed',{stage:'probe'});}
  const state=engine.state,port=state.status==='connected'?state.port:null;
  if(!port){logger.write('health.check',{stage:'probe',ok:false,reason:'unavailable'});return;}
  const sample=async(attempt,transport,phase,probe)=>{
    const start=Date.now();let facts;
    try{facts={ok:true,...await probe()};}catch(error){facts={ok:false,errorCode:error.code||'NETWORK_ERROR'};}
    if(engine.state!==state||engine.state.status!=='connected')facts={ok:false,reason:'cancelled'};
    logger.write('health.check',{stage:'probe',attempt,transport,phase,durationMs:Date.now()-start,...facts});
  };
  await Promise.all(PROBE_HOSTS.map(async(host,index)=>{
    // Ordinals identify fixed test targets without permitting arbitrary hosts in reports.
    await Promise.all([
      sample(index+1,'system','resolve',()=>lookup(host)),
      sample(index+1,'proxy','resolve',()=>proxyDns(engine,host)),
      sample(index+1,'system','request',()=>request(host)),
      sample(index+1,'proxy','request',()=>request(host,port)),
    ]);
  }));
}
