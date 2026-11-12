import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {recoveryProof} from '../desktop/account-recovery.mjs';
import {Account} from '../desktop/account.mjs';

test('recovery proof excludes endpoints and never exposes the private key to UI',async()=>{
  const key='a'.repeat(43)+'=',bundle={profiles:[{protocol:'AmneziaWG',privateKey:key,server:'192.0.2.1'}]};
  const proof=recoveryProof(bundle);assert.equal(proof,createHash('sha256').update('zphone-reauth-v1:'+key).digest('hex'));
  bundle.profiles[0].server='192.0.2.2';assert.equal(recoveryProof(bundle),proof);
  assert.equal(recoveryProof(null),undefined);assert.equal(recoveryProof({profiles:[]}),undefined);
  const account=new Account({config:{baseUrl:'https://example.invalid',botUsername:'example_bot'}});
  account.recoveryProof=()=>proof;
  account.token='t'.repeat(43);
  account.call=async(route,body)=>{assert.equal(route,'/v1/device/start');assert.deepEqual(body,{platform:'windows',recoveryProof:proof});return {code:'a'.repeat(32),secret:'b'.repeat(43),number:'123456',expires:9999999999};};
  await account.begin();assert(!JSON.stringify(account.snapshot()).includes(proof));assert(!JSON.stringify(account.snapshot()).includes(key));
});

test('imported profiles without a saved session use normal enrollment',async()=>{
  const account=new Account({config:{baseUrl:'https://example.invalid',botUsername:'example_bot'}});
  account.recoveryProof=()=>assert.fail('No recovery on an imported-only account');
  account.call=async(_route,body)=>{assert.deepEqual(body,{platform:'windows'});return {code:'a'.repeat(32),secret:'b'.repeat(43),number:'123456',expires:9999999999};};
  await account.begin();
});
