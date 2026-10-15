import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBundle,coreConfig,naiveConfig,candidates,publicProfiles} from '../shared/profiles.mjs';
const base={id:'extra',location:'FIN',server:'192.0.2.18',port:10443};
const key='a'.repeat(43)+'=';
const awg={...base,protocol:'AmneziaWG',privateKey:key,publicKey:key,presharedKey:key,ip:'10.9.0.2',mtu:1280,awg:{version:3,'header-protection-key':key,s4:28,h1:'100-120','random-trailers':true,'content-padding-addition':'0-32'}};
const hy={...base,protocol:'Hysteria2',password:'test-password',sni:'test.example',obfsPassword:'test-obfuscation'};
const naive={...base,protocol:'NaiveProxy',username:'test@user',password:'test:+/pass',sni:'test.example'};
const validate=p=>validateBundle({format:'zphone-test-v1',scope:'test',profiles:[p]}).profiles[0];
const config=p=>coreConfig(p,{port:12001,apiPort:12002,secret:'x'.repeat(24),naivePort:12003,mode:'vpn'});
test('AWG 3.1 preserves v3 flags and never accepts arbitrary engine options',()=>{
  const p=validate({...awg,awg:{...awg.awg,command:'do-not-run'}}),c=config(p);
  assert.equal(c.proxies[0].type,'wireguard');assert.equal(c.proxies[0]['amnezia-wg-option']['random-trailers'],true);
  assert.equal(p.awg.command,undefined);assert.equal(c.proxies[0]['private-key'],key);
  for(const changed of [{privateKey:'bad'},{ip:'10.999.0.1'},{awg:{...awg.awg,version:2}},{awg:{...awg.awg,h1:'200-100'}},{awg:{...awg.awg,s4:20000}},{awg:{...awg.awg,'random-trailers':'false'}}])assert.throws(()=>validate({...awg,...changed}));
});
test('Hysteria2 uses authenticated QUIC and verified TLS',()=>{
  const p=validate(hy),proxy=config(p).proxies[0];assert.equal(proxy.type,'hysteria2');assert.equal(proxy.obfs,'salamander');assert.equal(proxy['skip-cert-verify'],false);assert.equal(proxy['obfs-password'],hy.obfsPassword);
  assert.throws(()=>validate({...hy,obfsPassword:'x'}));
});

test('Hysteria2 accepts explicit Gecko without changing existing Salamander profiles',()=>{
  assert.equal(config(validate({...hy,obfsType:'gecko'})).proxies[0].obfs,'gecko');
  assert.equal(config(validate(hy)).proxies[0].obfs,'salamander');
  assert.throws(()=>validate({...hy,obfsType:'unknown'}));
  assert.throws(()=>validate({...hy,obfsType:'gecko',obfsPassword:undefined}));
  assert.throws(()=>validate({...naive,obfsType:'gecko'}));
});
test('NaiveProxy uses only its local helper, excludes only the endpoint and rejects UDP',()=>{
  const p=validate(naive),c=config(p);assert.equal(c.proxies[0].type,'socks5');assert.equal(c.proxies[0].udp,false);assert.equal(c.proxies[0].password,undefined);
  assert.deepEqual(c.tun['route-exclude-address'],[base.server+'/32']);assert.deepEqual(c.rules,['IP-CIDR6,::/0,REJECT,no-resolve','NETWORK,udp,REJECT','MATCH,Zphone-Test']);
  const n=naiveConfig(p,12003);assert.equal(n.listen,'socks://127.0.0.1:12003');assert(n.proxy.includes('test%40user:test%3A%2B%2Fpass@'));assert(!Object.keys(n).some(k=>k.includes('ignore-certificate')));
  assert.throws(()=>coreConfig(p,{port:12001,apiPort:12002,secret:'x'.repeat(24)}));
  assert.throws(()=>validate({...naive,server:'arbitrary.example'}));assert.throws(()=>validate({...naive,fingerprint:'a'.repeat(64)}));
});
test('new protocols remain individually selectable and public metadata is credential-free',()=>{
  const profiles=[naive,hy,awg].map(p=>validate({...p,id:p.protocol}));
  for(const p of profiles)assert.deepEqual(candidates(profiles,'FIN',p.protocol),[p]);
  for(const p of publicProfiles({profiles}))assert.deepEqual(Object.keys(p),['id','location','protocol']);
});
