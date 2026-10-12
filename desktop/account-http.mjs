import https from 'node:https';
import {isIP} from 'node:net';
import {readJson} from '../shared/release.mjs';

export function networkCode(error){
  const code=error?.cause?.code||error?.code||String(error?.message||'').match(/net::(ERR_[A-Z_]+)/)?.[1]||error?.name||'NETWORK_ERROR';
  return /^[A-Za-z0-9_]{1,64}$/.test(code)?code:'NETWORK_ERROR';
}
export function accountError(error){
  const code=networkCode(error),status=error?.status;
  let message='Не удалось связаться с сервисом входа. Попробуйте другую сеть и повторите вход. Если ошибка останется, отправьте архив диагностики в поддержку.';
  if(status===429)message='Слишком много попыток входа. Подождите минуту и повторите.';
  else if(status===401||status===403)message='Сессия или заявка больше не действуют. Начните вход заново.';
  else if(status)message='Сервис входа временно недоступен. Повторите попытку позже.';
  else if(/CERT|TLS|SSL/.test(code))message='Не удалось проверить защищённое соединение. Проверьте дату и время Windows. Не отключайте проверку сертификатов; отправьте диагностику в поддержку.';
  else if(/NOTFOUND|AGAIN|NAME_NOT_RESOLVED|DNS/.test(code))message='Не удалось найти сервис входа через DNS. Попробуйте другую сеть и повторите вход.';
  else if(/TIMEOUT|TIMEDOUT|TimeoutError/.test(code))message='Сервис входа не ответил вовремя. Попробуйте другую сеть и повторите вход.';
  return Object.assign(new Error(message),{code,status});
}
export function publicIpv4(value){
  if(isIP(value)!==4)return false;
  const [a,b]=value.split('.').map(Number);
  return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
export async function resolveAccountHost(hostname,fetcher){
  const response=await fetcher('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(hostname)+'&type=A',{headers:{accept:'application/dns-json'},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});
  const data=await readJson(response,32768);
  const address=data.Status===0&&data.Answer?.find(item=>item.type===1&&publicIpv4(item.data))?.data;
  if(!address)throw Object.assign(Error('DNS resolution failed'),{code:'DNS_NO_PUBLIC_ADDRESS'});
  return address;
}
// Only DNS is replaced. TLS still verifies the original hostname and certificate chain.
export function postAtAddress(url,options,address){
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{method:'POST',headers:options.headers,servername:url.hostname,rejectUnauthorized:true,agent:false,
      lookup:(_host,opts,cb)=>opts.all?cb(null,[{address,family:4}]):cb(null,address,4),signal:AbortSignal.timeout(12000)},res=>{
      if(res.statusCode!==200){res.resume();reject(Object.assign(Error('Access service response'),{status:res.statusCode,code:'HTTP_'+res.statusCode}));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>150000){res.destroy(Error('Response too large'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){reject(error);}});
    });
    req.on('error',reject);req.end(options.body);
  });
}
export function createAccountTransport({fetcher=globalThis.fetch,logger,resolveHost=resolveAccountHost,postResolved=postAtAddress}={}){
  const secureDnsOrigins=new Set();
  return async(url,data,token)=>{
    const options={method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data),redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)};
    const started=Date.now(),operation=url.pathname.split('/').at(-1);let received=false;
    const secureRequest=async()=>{
      try{
        const address=await resolveHost(url.hostname,fetcher);
        const result=await postResolved(url,options,address);
        secureDnsOrigins.add(url.origin);
        logger?.write('account.request',{operation,transport:'secure-dns',ok:true,durationMs:Date.now()-started});return result;
      }catch(error){
        logger?.write('account.request',{operation,transport:'secure-dns',ok:false,code:networkCode(error),status:error.status,durationMs:Date.now()-started});
        throw accountError(error);
      }
    };
    // Redeem uses the proven path directly, never a blind retry of a single-use request.
    if(secureDnsOrigins.has(url.origin))return secureRequest();
    try{
      const response=await fetcher(url,options);
      received=true;
      if(!response.ok)throw Object.assign(Error('Access service response'),{status:response.status,code:'HTTP_'+response.status});
      const result=await readJson(response,150000);
      logger?.write('account.request',{operation,transport:'system',ok:true,durationMs:Date.now()-started});return result;
    }catch(error){
      const code=networkCode(error);
      logger?.write('account.request',{operation,transport:'system',ok:false,code,status:error.status,durationMs:Date.now()-started});
      // Do not replay a redeem/logout after an ambiguous, possibly delivered request.
      const beforeSend=/NOTFOUND|AGAIN|NAME_NOT_RESOLVED|CERT|TLS|SSL|CONNECTION_REFUSED|ECONNREFUSED|CONNECT_TIMEOUT/.test(code);
      if(received||error.status||(!beforeSend&&['redeem','logout'].includes(operation)))throw accountError(error);
      return secureRequest();
    }
  };
}
