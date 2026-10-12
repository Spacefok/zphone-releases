import test from 'node:test';
import assert from 'node:assert/strict';
import {Account} from '../desktop/account.mjs';
test('device secret stays native and profiles require a redeemed approval',async()=>{
  let token=null;const account=new Account({config:{baseUrl:'https://example.invalid',botUsername:'example_bot'},readToken:async()=>token,writeToken:async value=>token=value});
  const req={code:'a'.repeat(32),secret:'b'.repeat(43),number:'123456',expires:9999999999};let approved=false;
  account.call=async route=>route.endsWith('/start')?req:route.endsWith('/poll')?{state:approved?'approved':'pending'}:{token:'c'.repeat(43)};
  await assert.rejects(account.profiles());const result=await account.begin();assert.equal(result.url,'https://t.me/example_bot?start=login_'+req.code);assert.ok(!JSON.stringify(account.snapshot()).includes(req.secret));
  await account.poll();assert.equal(token,null);approved=true;await account.poll();assert.equal(token,'c'.repeat(43));assert.equal(account.snapshot().state,'authorized');await account.logout();assert.equal(token,null);
});
test('expired requests do not create a session',async()=>{const account=new Account({config:{},writeToken:async()=>assert.fail('should not save')});account.pending={};account.call=async()=>({state:'expired'});assert.equal((await account.poll()).state,'expired');});
test('offline logout clears local access but does not claim server revocation',async()=>{
  let token='t'.repeat(43);const account=new Account({config:{baseUrl:'https://example.invalid'},readToken:async()=>token,writeToken:async value=>token=value});
  await account.restore();account.call=async()=>{throw Error('offline or expired');};await account.logout();
  assert.equal(token,null);assert.equal(account.snapshot().state,'signed_out');assert.match(account.snapshot().message,/не подтверждён/);await assert.rejects(account.profiles());
});
