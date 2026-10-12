import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const REPORT_BYTES=196608,REPORT_WINDOW_MS=180000,REPORT_RECORDS=1000;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const REPORT_EVENTS=new Set(`app.start app.error app.quit app.quit_requested system.resume
user.mark user.connect user.disconnect user.diagnose notification.disconnect settings.changed
connection.request connection.state connection.preflight connection.attempt_failed connection.failed connection.error connection.cleanup
core.spawn core.spawn_error core.exit core.stop_requested core.api_error core.line_dropped core.stream_error naive.spawn naive.spawn_error naive.exit
health.check health.failed health.proxy_ok recovery.request recovery.wait recovery.success recovery.failed recovery.preflight_failed recovery.attempt_failed recovery.cleanup_failed
cleanup.failed diagnose.error network.error network.snapshot_failed traffic.totals traffic.error traffic.unavailable account.request report.accepted report.failed`.split(/\s+/));
const enums={
  platform:['windows','android'],status:['off','connecting','checking','recovering','connected','disconnecting','error'],
  location:['auto','FIN','AMS','DEU'],protocol:['auto','TrustTunnel','Mieru','NaiveProxy','AmneziaWG','Hysteria2'],
  mode:['isolated','vpn'],splitMode:['all','exclude','include'],
  operation:['start','poll','redeem','profiles','logout','report'],transport:['system','secure-dns'],phase:['resolve','request'],
  stage:['startup','core','helper','tunnel','health','start','proxy','check','connect','launch','api','reachability','android-tunnel','vpn-reachability'],
  reason:['health','system.resume','core.exit','naive.exit','oversized'],signal:['SIGTERM','SIGKILL','SIGINT'],stream:['stdout','stderr'],
  errorType:['Error','TypeError','TimeoutError','AbortError','Exception','IOException','SocketException','SocketTimeoutException','UnknownHostException','SSLException','SSLHandshakeException','ConnectException','NetworkFailure'],
};
enums.connectionStatus=enums.status;
const codes=new Set('ETIMEDOUT ECONNRESET ENETUNREACH EHOSTUNREACH EPIPE ENOTFOUND EAI_AGAIN ECONNREFUSED UND_ERR_CONNECT_TIMEOUT UND_ERR_SOCKET ERR_NAME_NOT_RESOLVED ERR_CONNECTION_REFUSED ERR_CONNECTION_RESET ERR_CONNECTION_CLOSED ERR_CONNECTION_TIMED_OUT ERR_INTERNET_DISCONNECTED ERR_NETWORK_CHANGED NETWORK_ERROR DNS_ERROR DNS_NO_PUBLIC_ADDRESS IO_ERROR CONNECT_FAILED TLS_ERROR HTTP_ERROR AUTH_REJECTED ADMIN_REQUIRED VPN_CONFLICT ENOENT EACCES'.split(' '));
const numbers=new Set('durationMs delayMs latency attempt retryAttempt failures uploadBytes downloadBytes connections splitAppCount profileCount httpStatus exitCode count'.split(' '));
const bools=new Set(['ok','admin','configRemoved','coreStopped']);
const summaryKeys=['version','build','platform','connectionStatus','location','protocol','mode','splitMode','splitAppCount','profileCount'];
export function reportFields(input={}){
  const out={};
  if(!input||typeof input!=='object'||Array.isArray(input))return out;
  for(const [key,value] of Object.entries(input)){
    if(Object.hasOwn(enums,key)&&enums[key].includes(value))out[key]=value;
    else if(numbers.has(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER)out[key]=Math.round(value);
    else if(bools.has(key)&&typeof value==='boolean')out[key]=value;
    else if(key==='status'&&Number.isInteger(value)&&value>=100&&value<=599)out.httpStatus=value;
    else if(['code','errorCode'].includes(key)&&typeof value==='string'&&(codes.has(value)||/^(?:CORE_)?HTTP_[1-5]\d\d$/.test(value)))out.errorCode=value;
    else if(key==='code'&&Number.isInteger(value)&&value>=0&&value<=65535)out.exitCode=value;
    else if(key==='version'&&typeof value==='string'&&/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value))out[key]=value;
    else if(key==='build'&&typeof value==='string'&&/^(?:windows|android)-\d{8}\.\d{1,6}$/.test(value))out[key]=value;
  }
  // Extract only typed facts from native nested objects; never their messages, paths or names.
  if(input.error&&typeof input.error==='object')Object.assign(out,reportFields({errorType:input.error.name,errorCode:input.error.code}));
  if(input.route&&typeof input.route==='object')Object.assign(out,reportFields({location:input.route.location,protocol:input.route.protocol}));
  if(input.split&&typeof input.split==='object')Object.assign(out,reportFields({splitMode:input.split.mode,splitAppCount:input.split.count}));
  return out;
}
export async function createIssueReport(logger,metadata,{now=Date.now(),reportId=crypto.randomUUID()}={}){
  if(typeof reportId!=='string'||!UUID.test(reportId)||!Number.isFinite(now))throw Error('Invalid report identity');
  logger.flush();
  const safe=reportFields(metadata),summary=Object.fromEntries(summaryKeys.filter(key=>safe[key]!==undefined).map(key=>[key,safe[key]]));
  const report={reportId,created:new Date(now).toISOString(),summary,records:[]},records=[];
  for(let i=0;i<Math.min(logger.maxFiles,5);i++){
    const file=path.join(logger.directory,i?`diagnostics.${i}.jsonl`:'diagnostics.jsonl');
    let handle;
    try{
      const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)continue;
      handle=await fs.open(file,'r');const bytes=Buffer.alloc(stat.size);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
      for(const line of bytes.subarray(0,bytesRead).toString('utf8').split('\n')){
        if(line.length>65536)continue;
        try{
          const row=JSON.parse(line),iso=typeof row.time==='string'&&row.time.match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d{1,9}))?Z$/),time=iso?Date.parse(row.time):NaN;
          if(!Number.isFinite(time)||time<now-REPORT_WINDOW_MS||time>now||typeof row.session!=='string'||!UUID.test(row.session)||!REPORT_EVENTS.has(row.event))continue;
          if(new Date(time).toISOString().slice(0,19)!==row.time.slice(0,19)||(time===now&&/[1-9]/.test((iso[1]||'').slice(3))))continue;
          records.push({time:new Date(time).toISOString(),session:row.session,event:row.event,data:reportFields(row.data)});
        }catch{}
      }
    }catch(error){if(error.code!=='ENOENT')throw Error('Не удалось прочитать журнал. Повторите попытку.');}
    finally{await handle?.close();}
  }
  let size=Buffer.byteLength(JSON.stringify(report));
  records.sort((a,b)=>b.time.localeCompare(a.time));
  for(const row of records){
    const length=Buffer.byteLength(JSON.stringify(row))+(report.records.length?1:0);
    if(report.records.length>=REPORT_RECORDS||size+length>REPORT_BYTES)break;
    report.records.push(row);size+=length;
  }
  report.records.reverse();return report;
}
export function reportFailure(error){
  const status=error?.status,code=error?.code||'';
  let message='Приём отчёта не подтверждён. Повторите отправку в течение 3 минут, когда сеть станет доступна. Журнал продолжает записываться.';
  if(status===401||status===403)message='Сессия недействительна. Откройте «Аккаунт», выйдите и войдите через бота заново, затем повторите отправку.';
  else if(status===429)message='Слишком много отчётов. Подождите минуту и повторите отправку.';
  else if(/CERT|TLS|SSL/.test(code))message='Не удалось проверить защищённое соединение. Проверьте дату и время устройства и повторите отправку. Проверку сертификатов отключать не нужно.';
  return Object.assign(new Error(message),{status,code});
}
