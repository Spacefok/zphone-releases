import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROBE_HOSTS,collectServiceProbes,curlArguments,dnsCounts,deadline} from '../desktop/service-probes.mjs';
import {reportFields} from '../desktop/diagnostics-report.mjs';
test('fixed HTTPS targets retain certificate verification, ignore curlrc and never follow redirects',()=>{
 for(const host of PROBE_HOSTS){const args=curlArguments(host,12345);assert.equal(args[0],'--disable');assert(args.includes('http://127.0.0.1:12345'));assert(!args.includes('-k'));assert(!args.includes('--insecure'));assert(!args.includes('--location'));}
 assert.throws(()=>curlArguments('private.example'));assert.throws(()=>curlArguments(PROBE_HOSTS[0],0));assert(curlArguments(PROBE_HOSTS[0]).includes('*'));
});
test('report includes paired system/proxy facts without leaking hosts or addresses',async()=>{
 const rows=[],requests=[],engine={state:{status:'connected',port:12345},api:async route=>({Status:0,Answer:[{type:route.endsWith('AAAA')?28:1,data:'secret-address'}]})};
 await collectServiceProbes({engine,logger:{write:(event,data)=>rows.push({event,data:reportFields(data)})},network:async()=>({networkType:'wifi'}),lookup:async()=>({count:1,records:2}),request:async(host,port)=>{requests.push({host,port});return {httpStatus:403};}});
 const checks=rows.filter(r=>r.event==='health.check');assert.equal(checks.length,16);assert.equal(requests.length,8);assert(checks.every(r=>r.data.ok&&r.data.stage==='probe'));
 assert.deepEqual(new Set(checks.map(r=>r.data.attempt)),new Set([1,2,3,4]));const json=JSON.stringify(rows);assert(!json.includes('secret-address'));assert(PROBE_HOSTS.every(host=>!json.includes(host)));
 assert.deepEqual(dnsCounts([{family:4,address:'private'},{family:6}]),{count:1,records:1});
});
test('disconnected client generates no service traffic',async()=>{
 let calls=0;await collectServiceProbes({engine:{state:{status:'off'}},logger:{write(){}},lookup:()=>calls++,request:()=>calls++});assert.equal(calls,0);
});
test('DNS, TLS failures and a network change remain distinct from successful HTTP responses',async()=>{
 const rows=[],engine={state:{status:'connected',port:12345},api:async()=>({Status:2})};
 await collectServiceProbes({engine,logger:{write:(event,data)=>rows.push(data)},lookup:async()=>{throw Object.assign(Error('private'),{code:'DNS_ERROR'});},request:async()=>{throw Object.assign(Error('private'),{code:'TLS_ERROR'});}});
 assert(rows.some(r=>r.phase==='resolve'&&r.errorCode==='DNS_ERROR'));assert(rows.some(r=>r.phase==='request'&&r.errorCode==='TLS_ERROR'));
 await assert.rejects(deadline(new Promise(()=>{}),5),{code:'ETIMEDOUT'});
});
test('Android shares fixed target order and keeps self-excluded HTTPS on the local proxy',()=>{
 const source=fs.readFileSync('android/app/src/main/java/org/zphone/pilot/ServiceProbe.java','utf8');
 const targets=source.match(/HOSTS=List.of\(([^;]+)\);/)[1].match(/"([^"]+)"/g).map(x=>JSON.parse(x));assert.deepEqual(targets,PROBE_HOSTS);
 assert.match(source,/openConnection\(proxy\)/);assert.doesNotMatch(source,/setDefaultHostnameVerifier|setSSLSocketFactory|setHostnameVerifier|Settings\.Global\.put/);
 assert.match(source,/getString\(context.getContentResolver\(\),"private_dns_mode"\)/);
});
