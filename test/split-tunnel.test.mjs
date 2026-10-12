import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSplit,splitRules} from '../shared/split-tunnel.mjs';
import {coreConfig} from '../shared/profiles.mjs';
const app={id:'C:\\Program Files (x86)\\Example\\Browser.exe',name:'Browser'};
const profile={id:'test',location:'FIN',protocol:'Mieru',server:'192.0.2.1',port:443,username:'test',password:'test-password'};
const options={port:19000,apiPort:19001,secret:'s'.repeat(24),mode:'vpn'};

test('split settings default to all, deduplicate Windows paths and reject rule injection',()=>{
  assert.deepEqual(validateSplit(),{mode:'all',apps:[]});
  assert.equal(validateSplit({mode:'exclude',apps:[app,{...app,id:app.id.toLowerCase()}]}).apps.length,1);
  for(const id of ['browser.exe','C:\\x,REJECT.exe','C:\\x\n.exe','C:\\..\\x.exe','C:\\*.exe'])assert.throws(()=>validateSplit({mode:'include',apps:[{...app,id}]}));
  assert.throws(()=>validateSplit({mode:'other',apps:[]}));
});
test('Android accepts package IDs, rejects the VPN app and path values',()=>{
  assert.equal(validateSplit({mode:'include',apps:[{id:'com.android.chrome',name:'Chrome'}]},'android').apps.length,1);
  for(const id of [app.id,'org.zphone.pilot','com,bad'])assert.throws(()=>validateSplit({mode:'include',apps:[{id,name:'test'}]},'android'));
});
test('exclude rules bypass only explicit paths and keep the VPN default',()=>{
  const split={mode:'exclude',apps:[app]},config=coreConfig(profile,{...options,split});
  assert.deepEqual(config.rules,[`PROCESS-PATH,${app.id},DIRECT`,'MATCH,Zphone-Test']);
  assert.equal(config['find-process-mode'],'strict');
  assert(config.dns.nameserver.every(url=>url.endsWith('#Zphone-Test')));
});
test('include mode requires applications and rejects unresolved process identities',()=>{
  assert.throws(()=>splitRules({mode:'include',apps:[]},{vpn:true}));
  assert.deepEqual(splitRules({mode:'include',apps:[app]},{vpn:true}),[`PROCESS-PATH,${app.id},Zphone-Test`,'PROCESS-PATH-REGEX,^$,REJECT','MATCH,DIRECT']);
});
test('isolated tests do not apply system application bypass rules',()=>{
  const config=coreConfig(profile,{...options,mode:'isolated',split:{mode:'exclude',apps:[app]}});
  assert.deepEqual(config.rules,['MATCH,Zphone-Test']);assert.equal(config['find-process-mode'],'off');assert.equal(config.tun.enable,false);
});
test('Naive UDP cannot fall through to DIRECT in any split mode',()=>{
  assert.deepEqual(splitRules({mode:'all',apps:[]},{vpn:true,udp:false}),['NETWORK,udp,REJECT','MATCH,Zphone-Test']);
  assert.deepEqual(splitRules({mode:'exclude',apps:[app]},{vpn:true,udp:false}),[`PROCESS-PATH,${app.id},DIRECT`,'NETWORK,udp,REJECT','MATCH,Zphone-Test']);
  assert.deepEqual(splitRules({mode:'include',apps:[app]},{vpn:true,udp:false}),[`PROCESS-PATH,${app.id},Zphone-Test`,`PROCESS-PATH,${app.id},REJECT`,'PROCESS-PATH-REGEX,^$,REJECT','MATCH,DIRECT']);
});
test('IPv4-only AWG blocks IPv6 only on VPN-bound application routes',()=>{
  const awg={...profile,protocol:'AmneziaWG',ip:'10.0.0.2',mtu:1280};
  const all=coreConfig(awg,options);assert.equal(all.ipv6,true);assert.equal(all.dns.ipv6,false);assert.deepEqual(all.proxies[0]['allowed-ips'],['0.0.0.0/0']);
  assert.deepEqual(all.rules,['IP-CIDR6,::/0,REJECT,no-resolve','MATCH,Zphone-Test']);
  const exclude=coreConfig(awg,{...options,split:{mode:'exclude',apps:[app]}});assert.equal(exclude.rules[0],`PROCESS-PATH,${app.id},DIRECT`);assert.equal(exclude.rules[1],'IP-CIDR6,::/0,REJECT,no-resolve');
  const include=coreConfig(awg,{...options,split:{mode:'include',apps:[app]}});assert.equal(include.rules[0],`AND,((PROCESS-PATH,${app.id}),(IP-CIDR6,::/0,no-resolve)),REJECT`);assert.equal(include.rules.at(-1),'MATCH,DIRECT');
  assert.equal(include.dns.ipv6,true);assert.equal(exclude.dns.ipv6,true);
  assert.equal(coreConfig(profile,options).dns.ipv6,true);
});
