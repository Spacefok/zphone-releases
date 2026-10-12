export function validateSplit(value={mode:'all',apps:[]},platform='windows') {
  if(!value||!['all','exclude','include'].includes(value.mode)||!Array.isArray(value.apps)||value.apps.length>200)throw Error('Некорректные настройки приложений.');
  const apps=[],seen=new Set();
  for(const item of value.apps){
    if(!item||typeof item.id!=='string'||typeof item.name!=='string'||!item.name.length||item.name.length>150)throw Error('Некорректное приложение.');
    const id=item.id;
    const valid=platform==='android'?/^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(id)&&id!=='org.zphone.pilot':/^[A-Za-z]:\\.+\.exe$/i.test(id)&&id.length<=1024&&!/[\x00-\x1f,<>"|?*]/.test(id)&&!/(?:^|\\)\.\.(?:\\|$)/.test(id);
    if(!valid)throw Error('Нужен полный путь к .exe или допустимое имя пакета.');
    const key=platform==='windows'?id.toLowerCase():id;
    if(!seen.has(key)){seen.add(key);apps.push({id,name:item.name});}
  }
  return {mode:value.mode,apps};
}

export function splitRules(value,{vpn=false,udp=true,ipv6=true}={}) {
  const split=validateSplit(value);
  const rules=[];
  if(vpn&&split.mode!=='all'){
    if(split.mode==='include'&&!split.apps.length)throw Error('Выберите хотя бы одно приложение для VPN.');
    for(const app of split.apps){
      if(split.mode==='include'&&!ipv6)rules.push(`AND,((PROCESS-PATH,${app.id}),(IP-CIDR6,::/0,no-resolve)),REJECT`);
      rules.push(`PROCESS-PATH,${app.id},${split.mode==='exclude'?'DIRECT':'Zphone-Test'}`);
      // Unsupported UDP must not fall through to the DIRECT catch-all.
      if(split.mode==='include'&&!udp)rules.push(`PROCESS-PATH,${app.id},REJECT`);
    }
    if(split.mode==='include')return [...rules,'PROCESS-PATH-REGEX,^$,REJECT','MATCH,DIRECT'];
  }
  if(!ipv6)rules.push('IP-CIDR6,::/0,REJECT,no-resolve');
  if(!udp)rules.push('NETWORK,udp,REJECT');
  return [...rules,'MATCH,Zphone-Test'];
}
