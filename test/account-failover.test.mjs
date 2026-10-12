import test from 'node:test';
import assert from 'node:assert/strict';
import {Account} from '../desktop/account.mjs';
import {accessEndpoints,canRetryAccess} from '../shared/account-policy.mjs';
const config={baseUrl:'https://first.example',baseUrls:['https://first.example','https://second.example','https://third.example'],botUsername:'example_bot'};
test('fallback validates every origin before sending credentials',()=>{
  for(const bad of ['http://example.com','https://user:pass@example.com','https://example.com/private','https://example.com?x=1','https://example.com#x'])assert.throws(()=>accessEndpoints({...config,baseUrls:[config.baseUrl,bad]}));
  assert.throws(()=>accessEndpoints({baseUrls:[]}));assert.throws(()=>accessEndpoints({baseUrls:Array(4).fill(config.baseUrl)}));
  assert.deepEqual(accessEndpoints({baseUrl:config.baseUrl}),[config.baseUrl]);
});
test('one session works across gateways and the healthy origin is preferred',async()=>{
  const calls=[];let offline=new Set(['first.example']);
  const account=new Account({config,readToken:async()=> 't'.repeat(43),transport:async(url,data,token)=>{
    calls.push(url.hostname);assert.equal(token,'t'.repeat(43));
    if(offline.has(url.hostname))throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});
    return {state:'ready'};
  }});
  await account.restore();await account.profiles();await account.profiles();
  assert.deepEqual(calls,['first.example','second.example','second.example']);
  offline.add('second.example');await account.profiles();assert.equal(calls.at(-1),'third.example');
});
test('all unreachable endpoints fail finitely',async()=>{
  let calls=0;const account=new Account({config,transport:async()=>{calls++;throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});}});
  await assert.rejects(account.call('/v1/device/start',{platform:'windows'}));assert.equal(calls,3);
});
test('rejections and ambiguous single-use requests never try another gateway',async()=>{
  for(const route of ['/v1/device/redeem','/v1/session/logout']){
    assert.equal(canRetryAccess(route,{code:'ETIMEDOUT'}),false);
    assert.equal(canRetryAccess(route,{status:502}),false);
    assert.equal(canRetryAccess(route,{code:'ENOTFOUND'}),true);
  }
  for(const status of [401,403,429])assert.equal(canRetryAccess('/v1/device/start',{status}),false);
  assert.equal(canRetryAccess('/v1/session/profiles',{status:503}),true);
  assert.equal(canRetryAccess('/v1/session/profiles',{received:true,code:'ETIMEDOUT'}),false);
  let calls=0;const account=new Account({config,transport:async()=>{calls++;throw Object.assign(Error('denied'),{status:403});}});
  await assert.rejects(account.call('/v1/device/poll',{}));assert.equal(calls,1);
});
