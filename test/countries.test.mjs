import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COUNTRY_RECORDS,COUNTRIES,LOCATION_CODES,isCountry,isLocation,isLocationSelection,profileCountry,availableLocations,countryName,locationName,countryFlag} from '../shared/countries.mjs';
import {validateBundle,publicProfiles,candidates,PROTOCOLS} from '../shared/profiles.mjs';
import {reportFields} from '../desktop/diagnostics-report.mjs';
import {Engine} from '../desktop/engine.mjs';

const base={id:'test',location:'DEU',protocol:'TrustTunnel',server:'192.0.2.1',port:443,username:'test',password:'test-only',sni:'test.example'};
const bundle=profiles=>({format:'zphone-test-v1',scope:'test',profiles});
const checked=profile=>validateBundle(bundle([profile])).profiles[0];

test('249 assigned countries round-trip alpha-2/alpha-3 on both platforms',()=>{
  assert.equal(COUNTRIES.length,249);assert.equal(new Set(COUNTRIES).size,249);
  assert.equal(new Set(COUNTRY_RECORDS.map(r=>r.slice(2))).size,249);
  assert.equal(LOCATION_CODES.length,499);
  for(const record of COUNTRY_RECORDS){
    assert.match(record,/^[A-Z]{5}$/);
    const country=record.slice(0,2);
    assert(isCountry(country));assert(isLocation(country));assert(isLocation(record.slice(2)));
    assert.equal(checked({...base,location:country}).country,country);
    assert.equal(checked({...base,location:record.slice(2)}).country,country);
    assert.equal(countryFlag(country),`./flags/${country.toLowerCase()}.png`);
    const png=fs.readFileSync('public/'+countryFlag(country).slice(2));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),96);assert.equal(png.readUInt32BE(20),72);
    assert(countryName(country).length>0);
  }
  const java=fs.readFileSync('android/app/src/main/java/org/zphone/pilot/Countries.java','utf8');
  const records=java.match(/RECORDS=([\s\S]*?);/)[1].match(/"([^"]*)"/g).map(s=>JSON.parse(s)).join('').split(' ');
  assert.deepEqual(records,COUNTRY_RECORDS);
});

test('legacy IDs infer countries and explicit Czech metadata preserves the logical slot',()=>{
  for(const [location,country] of [['FIN','FI'],['AMS','NL'],['DEU','DE']])assert.equal(checked({...base,location}).country,country);
  const p=checked({...base,country:'CZ'});
  assert.equal(p.location,'DEU');assert.equal(p.id,base.id);assert.equal(p.country,'CZ');
  assert.equal(locationName(p,'en'),new Intl.DisplayNames(['en'],{type:'region'}).of('CZ'));
  assert.deepEqual(publicProfiles(bundle([p])),[{id:'test',location:'DEU',protocol:'TrustTunnel',country:'CZ'}]);
  assert.equal(candidates([p],'DEU').length,1);assert.equal(candidates([p],'CZ').length,0);
});

test('one location can contain all five protocols but must have one country',()=>{
  const key='a'.repeat(43)+'=';
  const profiles=PROTOCOLS.map((protocol,index)=>({...base,id:'test-'+index,country:'CZ',protocol,
    ...(protocol==='AmneziaWG'?{ip:'10.9.0.2',mtu:1280,privateKey:key,publicKey:key,presharedKey:key,awg:{version:3,'header-protection-key':key}}:{})}));
  const clean=validateBundle(bundle(profiles));
  assert.equal(clean.profiles.length,5);
  assert.deepEqual(availableLocations(publicProfiles(clean)),[{location:'DEU',country:'CZ'}]);
  for(const protocol of PROTOCOLS)assert.equal(candidates(clean.profiles,'DEU',protocol).length,1);
  for(const country of ['DE','FI',undefined]){
    const changed=structuredClone(profiles);if(country===undefined)delete changed[4].country;else changed[4].country=country;
    assert.throws(()=>validateBundle(bundle(changed)),/Conflicting/);
  }
  assert.throws(()=>validateBundle(bundle([profiles[0],profiles[0]])));
});

test('metadata fails closed and cannot supply a URL, asset, arbitrary label or country alias',()=>{
  for(const country of [undefined,null,true,42,{},[],['CZ'],'cz','CZE','UK','ZZ','EU','XK','../CZ','https://test.example','CZ" onerror="x','<svg>']){
    assert.throws(()=>checked({...base,country}));assert.equal(isCountry(country),false);
  }
  for(const location of [null,42,{},'auto','cz','Cz','ZZ','XK','EU','AN','SUN','__proto__','constructor','CZ-PRG','../../CZ','<img src=x>']){
    assert.equal(isLocation(location),false);assert.throws(()=>checked({...base,location,country:'CZ'}));
  }
  assert.throws(()=>checked({...base,location:'CZ',country:'US'}));
  const p=checked({...base,country:'CZ',countryName:'<img src=x>',flag:'https://test.example',flagUrl:'file:///private'});
  assert.equal(p.countryName,undefined);assert.equal(p.flag,undefined);assert.equal(p.flagUrl,undefined);
  assert.throws(()=>countryFlag('file:///private'));assert.throws(()=>countryName('<img>'));
  assert(isLocationSelection('auto'));assert(!isLocationSelection('AUTO'));
});

test('only supplied locations are offered, even for a large catalog or stale selection',()=>{
  assert.deepEqual(availableLocations([]),[]);
  const profiles=[checked({...base,id:'czech',country:'CZ'}),checked({...base,id:'japan',location:'JP'}),checked({...base,id:'japan-2',location:'JP',protocol:'Mieru'})];
  assert.deepEqual(availableLocations(profiles),[{location:'DEU',country:'CZ'},{location:'JP',country:'JP'}]);
  assert.equal(candidates(profiles,'FIN').length,0);
  assert.deepEqual(availableLocations([profiles[1]]),[{location:'JP',country:'JP'}]);
});

test('Anguilla metadata is valid without a broad prose-scanner exemption',()=>{
  const country=profileCountry({location:'AIA'});
  assert.equal(country,'AIA'.slice(0,2));assert.equal(checked({...base,location:country}).country,country);
  const proseToken=new RegExp('\\b'+country+'\\b','i');
  for(const path of ['shared/countries.mjs','android/app/src/main/java/org/zphone/pilot/Countries.java'])assert(!proseToken.test(fs.readFileSync(path,'utf8')));
});

test('reports accept catalog locations but not arbitrary strings',()=>{
  for(const location of LOCATION_CODES)assert.deepEqual(reportFields({location}),{location});
  assert.deepEqual(reportFields({location:'https://test.example'}),{});
});

test('Windows initial and recovery status retain country metadata without starting a VPN',async()=>{
  class Fake extends Engine {
    async cleanup(){clearInterval(this.monitor);this.active=null;}
    async launch(){this.active={port:19000};}
    async check(){return 10;}
  }
  const engine=new Fake({binary:'unused',directory:'unused',retryDelays:[0]});
  const p=checked({...base,country:'CZ'}),selection={location:'DEU',protocol:'TrustTunnel'};
  try{
    await engine.start([p],selection);
    assert.deepEqual(engine.state.route,{location:'DEU',protocol:'TrustTunnel',country:'CZ'});
    await engine.recover('test');assert.equal(engine.state.route.country,'CZ');
    assert.deepEqual(selection,{location:'DEU',protocol:'TrustTunnel'});
  }finally{await engine.stop();}
});
