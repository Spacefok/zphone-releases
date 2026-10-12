import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBundle,candidates,publicProfiles,coreConfig,compareVersion} from '../shared/profiles.mjs';
const profile={id:'test-fin',location:'FIN',protocol:'TrustTunnel',server:'vpn.example.org',port:443,username:'test',password:'test-only',sni:'vpn.example.org',fingerprint:'a'.repeat(64)};
const bundle=profiles=>({format:'zphone-test-v1',scope:'test',profiles});
test('reject production and malformed imports',()=>{
  assert.throws(()=>validateBundle({...bundle([profile]),scope:'production'}));
  assert.throws(()=>validateBundle(bundle([{...profile,server:'bad host'}])));
  assert.throws(()=>validateBundle(bundle([{...profile,fingerprint:'bad'}])));
  assert.throws(()=>validateBundle(bundle([profile,profile])));
  assert.throws(()=>validateBundle(bundle([{...profile,port:1.5}])));
});
test('strip untrusted engine options and hide credentials from UI',()=>{
  const checked=validateBundle(bundle([{...profile,'skip-cert-verify':true,'external-ui':'https://bad.example'}]));
  assert.equal(checked.profiles[0]['external-ui'],undefined);
  assert.deepEqual(Object.keys(publicProfiles(checked)[0]),['id','location','protocol']);
});
test('manual selection never falls back to a different protocol or location',()=>{
  const profiles=[profile,{...profile,id:'test-ams',location:'AMS'},{...profile,id:'test-mieru',protocol:'Mieru'}];
  assert.deepEqual(candidates(profiles,'FIN','Mieru').map(p=>p.id),['test-mieru']);
  assert(candidates(profiles,'FIN','auto').every(p=>p.location==='FIN'));
  assert.equal(candidates(profiles,'auto','auto').length,3);
});
test('isolated mode never activates TUN and limits listeners to loopback',()=>{
  const c=coreConfig(profile,{port:19000,apiPort:19001,secret:'x'.repeat(24)});
  assert.equal(c.tun.enable,false);assert.equal(c['bind-address'],'127.0.0.1');assert.equal(c['allow-lan'],false);
  assert.equal(c['external-controller'],'127.0.0.1:19001');assert.equal(c.proxies[0].fingerprint,profile.fingerprint);
});
test('TLS without a pinned certificate retains PKI verification',()=>{
  const p={...profile};delete p.fingerprint;
  assert.equal(coreConfig(p,{port:19000,apiPort:19001,secret:'x'.repeat(24)}).proxies[0]['skip-cert-verify'],false);
});
test('TLS random prefixes are bounded, preserved and never exposed in UI',()=>{
  const b=validateBundle(bundle([{...profile,clientRandomPrefix:'Aa1234'}]));
  assert.equal(b.profiles[0].clientRandomPrefix,'aa1234');
  assert.equal(coreConfig(b.profiles[0],{port:19000,apiPort:19001,secret:'x'.repeat(24)}).proxies[0]['client-random-prefix'],'aa1234');
  assert.equal(publicProfiles(b)[0].clientRandomPrefix,undefined);
  for(const prefix of ['', 'abc', 'zz', 'ff'.repeat(17)])assert.throws(()=>validateBundle(bundle([{...profile,clientRandomPrefix:prefix}])));
  assert.throws(()=>validateBundle(bundle([{...profile,protocol:'Mieru',clientRandomPrefix:'abcd'}])));
});
test('version comparison handles numeric components and invalid releases',()=>{
  assert.equal(compareVersion('0.10.0','0.2.0'),1);assert.equal(compareVersion('0.1.0','0.1.0'),0);assert.equal(compareVersion('0.0.9','0.1.0'),-1);assert.throws(()=>compareVersion('v1.2.3','0.1.0'));
});
