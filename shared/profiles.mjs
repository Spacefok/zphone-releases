import {validateSplit,splitRules} from './split-tunnel.mjs';
export const VERSION='0.6.8';
export const PROTOCOLS=['TrustTunnel','Mieru','NaiveProxy','AmneziaWG','Hysteria2'];
const host=/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const str=(v,min,max)=>typeof v==='string'&&v.length>=min&&v.length<=max;
const key=v=>typeof v==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(v);
const ipv4=v=>typeof v==='string'&&/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)&&v.split('.').every(n=>Number(n)<=255);
export const supportsIpv6=profile=>profile.ipv6===true&&profile.protocol!=='AmneziaWG';
export function validateAwg(input){
  if(!input||input.version!==3||!key(input['header-protection-key']))throw Error('Нужны параметры AmneziaWG 3.1.');
  const output={version:3,'header-protection-key':input['header-protection-key']};
  for(const k of ['jc','jmin','jmax','s1','s2','s3','s4'])if(input[k]!==undefined){if(!Number.isInteger(input[k])||input[k]<0||input[k]>(k==='jc'?128:1400))throw Error('Некорректный параметр AWG.');output[k]=input[k];}
  if((output.jmin||0)>(output.jmax||0))throw Error('Некорректный диапазон AWG.');
  for(const k of ['h1','h2','h3','h4','content-padding-addition','rekey-after-time','rekey-timeout','reject-after-time','keepalive-timeout','max-handshake-attempts'])if(input[k]!==undefined){
    const value=String(input[k]);const parts=value.split('-').map(Number);
    if(!/^\d{1,10}(?:-\d{1,10})?$/.test(value)||parts.some(n=>n>4294967295)||(parts.length===2&&parts[0]>parts[1]))throw Error('Некорректный диапазон AWG.');
    output[k]=value;
  }
  for(const k of ['random-trailers','disable-cookies'])if(input[k]!==undefined){if(typeof input[k]!=='boolean')throw Error('Некорректный флаг AWG.');output[k]=input[k];}
  return output;
}
export function validateBundle(value) {
  if(!value||value.format!=='zphone-test-v1'||value.scope!=='test'||!Array.isArray(value.profiles)||!value.profiles.length||value.profiles.length>32)throw Error('Нужен файл подключений Zphone.');
  const seen=new Set();
  const profiles=value.profiles.map(p=>{
    if(!p||!str(p.id,1,60)||!/^[a-zA-Z0-9_-]+$/.test(p.id)||seen.has(p.id))throw Error('Некорректный или повторяющийся идентификатор.');
    seen.add(p.id);
    if(!['FIN','AMS','DEU'].includes(p.location)||!PROTOCOLS.includes(p.protocol))throw Error('Неподдерживаемая локация или протокол.');
    if(!str(p.server,1,253)||!host.test(p.server)||!Number.isInteger(p.port)||p.port<1||p.port>65535)throw Error('Некорректный адрес подключения.');
    if(p.ipv6!==undefined&&typeof p.ipv6!=='boolean')throw Error('Некорректная поддержка IPv6.');
    const capability={ipv6:supportsIpv6(p)};
    if(p.protocol==='AmneziaWG'){
      if(!ipv4(p.ip)||!key(p.privateKey)||!key(p.publicKey)||!key(p.presharedKey)||!Number.isInteger(p.mtu)||p.mtu<576||p.mtu>1400)throw Error('Некорректный ключ или адрес AWG.');
      return {id:p.id,location:p.location,protocol:p.protocol,server:p.server,port:p.port,...capability,ip:p.ip,privateKey:p.privateKey,publicKey:p.publicKey,presharedKey:p.presharedKey,mtu:p.mtu,awg:validateAwg(p.awg)};
    }
    if(!str(p.password,1,512)||(p.protocol!=='Hysteria2'&&!str(p.username,1,128)))throw Error('В доступе отсутствуют учётные данные.');
    if(p.protocol==='NaiveProxy'&&(!ipv4(p.server)||!str(p.sni,1,253)||p.fingerprint!==undefined))throw Error('NaiveProxy требует IPv4 узла и DNS-имя с доверенным сертификатом.');
    if(p.obfsPassword!==undefined&&(p.protocol!=='Hysteria2'||!str(p.obfsPassword,8,128)))throw Error('Некорректный параметр Hysteria.');
    if(p.obfsType!==undefined&&(p.protocol!=='Hysteria2'||!p.obfsPassword||!['salamander','gecko'].includes(p.obfsType)))throw Error('Некорректный тип маскировки Hysteria.');
    if(p.sni!==undefined&&(!str(p.sni,1,253)||!host.test(p.sni)))throw Error('Некорректный SNI.');
    if(p.fingerprint!==undefined&&!/^[a-fA-F0-9]{64}$/.test(p.fingerprint))throw Error('Некорректный отпечаток сертификата.');
    if(p.clientRandomPrefix!==undefined&&(!/^(?:[a-fA-F0-9]{2}){1,16}$/.test(p.clientRandomPrefix)||p.protocol!=='TrustTunnel'))throw Error('Некорректный TLS-префикс.');
    return {id:p.id,location:p.location,protocol:p.protocol,server:p.server,port:p.port,...capability,...(p.protocol!=='Hysteria2'?{username:p.username}:{}),password:p.password,...(p.sni?{sni:p.sni}:{}),...(p.fingerprint?{fingerprint:p.fingerprint.toLowerCase()}: {}),...(p.clientRandomPrefix?{clientRandomPrefix:p.clientRandomPrefix.toLowerCase()}: {}),...(p.obfsPassword?{obfsPassword:p.obfsPassword}:{}),...(p.obfsType?{obfsType:p.obfsType}:{})};
  });
  return {format:'zphone-test-v1',scope:'test',profiles};
}
export function publicProfiles(bundle) {
  return (bundle?.profiles||[]).map(({id,location,protocol})=>({id,location,protocol}));
}
export function candidates(profiles,location='auto',protocol='auto') {
  if(!['auto','FIN','AMS','DEU'].includes(location)||!['auto',...PROTOCOLS].includes(protocol))throw Error('Некорректный выбор подключения.');
  return profiles.filter(p=>(location==='auto'||p.location===location)&&(protocol==='auto'||p.protocol===protocol)).sort((a,b)=>PROTOCOLS.indexOf(a.protocol)-PROTOCOLS.indexOf(b.protocol)||a.location.localeCompare(b.location));
}
export function naiveConfig(profile,port){
  if(profile.protocol!=='NaiveProxy'||!ipv4(profile.server)||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid Naive runtime');
  return {listen:`socks://127.0.0.1:${port}`,proxy:`https://${encodeURIComponent(profile.username)}:${encodeURIComponent(profile.password)}@${profile.sni}:${profile.port}`,'host-resolver-rules':`MAP ${profile.sni} ${profile.server}`,log:''};
}
export function coreConfig(profile,{port,apiPort,secret,mode='isolated',naivePort,split={mode:'all',apps:[]}}={}) {
  if(!Number.isInteger(port)||!Number.isInteger(apiPort)||!str(secret,16,128))throw Error('Missing local runtime parameters');
  const proxy={name:'Zphone-Test',type:profile.protocol==='Mieru'?'mieru':'trusttunnel',server:profile.server,port:profile.port,username:profile.username,password:profile.password,udp:true};
  if(!PROTOCOLS.includes(profile.protocol))throw Error('Unsupported protocol');
  if(profile.protocol==='Mieru')Object.assign(proxy,{transport:'TCP',multiplexing:'MULTIPLEXING_LOW','handshake-mode':'HANDSHAKE_STANDARD'});
  else if(profile.protocol==='AmneziaWG')Object.assign(proxy,{type:'wireguard',ip:profile.ip,'private-key':profile.privateKey,'public-key':profile.publicKey,'pre-shared-key':profile.presharedKey,'allowed-ips':['0.0.0.0/0'],'persistent-keepalive':25,mtu:profile.mtu,'amnezia-wg-option':profile.awg});
  else if(profile.protocol==='NaiveProxy'){
    if(!Number.isInteger(naivePort)||naivePort<1||naivePort>65535)throw Error('Naive helper is required');
    Object.assign(proxy,{type:'socks5',server:'127.0.0.1',port:naivePort,udp:false});delete proxy.username;delete proxy.password;
  }else{
    Object.assign(proxy,{type:profile.protocol==='Hysteria2'?'hysteria2':'trusttunnel',sni:profile.sni||profile.server,'skip-cert-verify':Boolean(profile.fingerprint),...(profile.fingerprint?{fingerprint:profile.fingerprint}:{})});
    if(profile.protocol==='TrustTunnel')proxy.quic=false;
    if(profile.protocol==='Hysteria2'&&profile.obfsPassword)Object.assign(proxy,{obfs:profile.obfsType||'salamander','obfs-password':profile.obfsPassword});
  }
  if(profile.protocol==='TrustTunnel'&&profile.clientRandomPrefix)proxy['client-random-prefix']=profile.clientRandomPrefix;
  split=validateSplit(split);
  const splitting=mode==='vpn'&&split.mode!=='all';
  const outboundIpv6=supportsIpv6(profile);
  return {'mixed-port':port,'bind-address':'127.0.0.1','allow-lan':false,'external-controller':`127.0.0.1:${apiPort}`,secret,mode:'rule','log-level':'silent',ipv6:true,'find-process-mode':splitting?'strict':'off','profile':{'store-selected':false,'store-fake-ip':false},dns:{enable:true,ipv6:outboundIpv6||splitting,'respect-rules':true,'enhanced-mode':'redir-host',nameserver:['https://1.1.1.1/dns-query','https://1.0.0.1/dns-query'].map(url=>splitting?url+'#Zphone-Test':url),'proxy-server-nameserver':['https://1.1.1.1/dns-query']},tun:{enable:mode==='vpn',device:'ZphoneTest',stack:'gvisor','auto-route':true,'strict-route':true,'auto-detect-interface':true,'dns-hijack':['any:53'],mtu:1400,...(profile.protocol==='NaiveProxy'?{'route-exclude-address':[profile.server+'/32']}:{})},proxies:[proxy],rules:splitRules(split,{vpn:mode==='vpn',udp:profile.protocol!=='NaiveProxy',ipv6:outboundIpv6})};
}
export function compareVersion(a,b) {
  const parse=v=>{if(!/^\d+\.\d+\.\d+$/.test(v))throw Error('Invalid release version');return v.split('.').map(Number);};
  const x=parse(a),y=parse(b);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);
  return 0;
}
