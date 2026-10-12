import test from 'node:test';
import assert from 'node:assert/strict';
import {conflictingAdapters} from '../desktop/windows-network.mjs';
const amnezia={Name:'AmneziaVPN',InterfaceDescription:'WireGuard Tunnel',Status:'Up',ifIndex:2};
const radmin={Name:'Radmin VPN',InterfaceDescription:'Famatech Radmin VPN Ethernet Adapter',Status:'Up',ifIndex:7};
test('active Amnezia remains blocked with an auxiliary Radmin LAN',()=>{
  assert.deepEqual(conflictingAdapters({adapters:[amnezia,radmin],routedInterfaces:[2]}),[amnezia]);
});
test('Radmin LAN alone does not prevent TUN while Ethernet routes the Internet',()=>{
  assert.deepEqual(conflictingAdapters({adapters:[{...amnezia,Status:'Disconnected'},radmin],routedInterfaces:[4]}),[]);
});
test('Radmin is blocked when it carries an Internet route, including IPv6',()=>{
  assert.deepEqual(conflictingAdapters({adapters:[radmin],routedInterfaces:[4,7]}),[radmin]);
});
test('an adapter cannot bypass the guard by its name alone',()=>{
  const spoofed={...amnezia,Name:'Radmin VPN'};
  assert.deepEqual(conflictingAdapters({adapters:[spoofed],routedInterfaces:[4]}),[spoofed]);
});
test('missing route inventory fails closed',()=>{
  assert.throws(()=>conflictingAdapters({adapters:[radmin],routedInterfaces:[]}));
});
test('Windows Teredo is not mistaken for an application VPN',()=>{
  const teredo={Name:'Teredo Tunneling Pseudo-Interface',InterfaceDescription:'Microsoft Teredo Tunneling Adapter',Status:'Up',ifIndex:15};
  assert.deepEqual(conflictingAdapters({adapters:[teredo],routedInterfaces:[4]}),[]);
});
