import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountTransport,networkCode,accountError,publicIpv4,resolveAccountHost} from '../desktop/account-http.mjs';
const url=new URL('https://access.example/v1/device/start');
test('account transport uses native fetch and logs no device secrets or URLs',async()=>{
  const events=[];const transport=createAccountTransport({fetcher:async(input,options)=>{
    assert.equal(input.href,url.href);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.authorization,'Bearer private-token');return new Response('{"ok":true}');
  },logger:{write:(event,data)=>events.push({event,data})}});
  assert.deepEqual(await transport(url,{secret:'device-secret'},'private-token'),{ok:true});
  for(const secret of ['private-token','device-secret',url.hostname])assert(!JSON.stringify(events).includes(secret));
});
test('a DNS failure tries encrypted resolution and preserves hostname for TLS',async()=>{
  let called=0;
  const transport=createAccountTransport({fetcher:async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'ENOTFOUND'}});},resolveHost:async host=>{assert.equal(host,'access.example');return '1.2.3.4';},postResolved:async(target,options,address)=>{
    called++;assert.equal(target.hostname,'access.example');assert.equal(address,'1.2.3.4');assert.equal(options.headers.authorization,'Bearer private-token');return {ok:true};
  }});
  assert.deepEqual(await transport(url,{},'private-token'),{ok:true});assert.equal(called,1);
});
test('HTTP rejections never use a fallback or leak an error response body',async()=>{
  const transport=createAccountTransport({fetcher:async()=>new Response('secret diagnostic',{status:429}),resolveHost:()=>assert.fail('must not resolve')});
  await assert.rejects(transport(url,{}),error=>error.code==='HTTP_429'&&error.message.includes('минуту')&&!error.message.includes('secret'));
});
test('ambiguous redeem failure is not replayed',async()=>{
  const transport=createAccountTransport({fetcher:async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNRESET'}});},resolveHost:()=>assert.fail('must not replay')});
  await assert.rejects(transport(new URL('/v1/device/redeem',url),{}));
});
test('a working fallback is used directly for single-use redemption',async()=>{
  let primaryCalls=0;const paths=[];
  const transport=createAccountTransport({fetcher:async()=>{primaryCalls++;throw Error('net::ERR_NAME_NOT_RESOLVED');},resolveHost:async()=> '1.2.3.4',postResolved:async target=>{paths.push(target.pathname);return {ok:true};}});
  await transport(url,{});await transport(new URL('/v1/device/redeem',url),{});
  assert.equal(primaryCalls,1);assert.deepEqual(paths,['/v1/device/start','/v1/device/redeem']);
});
test('malformed responses are not replayed through a second transport',async()=>{
  const transport=createAccountTransport({fetcher:async()=>new Response('{'),resolveHost:()=>assert.fail('must not replay')});
  await assert.rejects(transport(url,{}));
});
test('fallback TLS errors fail closed with actionable text',async()=>{
  const transport=createAccountTransport({fetcher:async()=>{throw Error('net::ERR_NAME_NOT_RESOLVED');},resolveHost:async()=> '1.2.3.4',postResolved:async()=>{throw Object.assign(Error('private host certificate'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});}});
  await assert.rejects(transport(url,{}),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID'&&error.message.includes('сертификатов')&&!error.message.includes('private host'));
});
test('DoH accepts only a public IPv4 answer and sends no session credentials',async()=>{
  for(const value of ['127.0.0.1','10.0.0.1','192.168.1.1','172.20.0.1','169.254.0.1','::1','100.64.0.1','224.0.0.1'])assert.equal(publicIpv4(value),false,value);
  const address=await resolveAccountHost('access.example',async(input,options)=>{assert(input.includes('name=access.example'));assert.equal(options.headers.authorization,undefined);return new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'127.0.0.1'},{type:1,data:'1.2.3.4'}]}));});
  assert.equal(address,'1.2.3.4');await assert.rejects(resolveAccountHost('access.example',async()=>new Response('{"Status":3}')));
});
test('network errors expose bounded codes, not opaque low-level URLs',()=>{
  assert.equal(networkCode(Error('net::ERR_CONNECTION_REFUSED')),'ERR_CONNECTION_REFUSED');
  assert.equal(networkCode({code:'private://token'}),'NETWORK_ERROR');
  assert.match(accountError({cause:{code:'ENOTFOUND'}}).message,/DNS/);
  assert.match(accountError({name:'TimeoutError'}).message,/вовремя/);
});
