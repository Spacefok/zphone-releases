import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../android/app/src/main/java/org/zphone/pilot/TunnelService.java',import.meta.url),'utf8');

test('Android advertises only the internal VPN resolver',()=>{
  assert.match(source,/VPN_DNS_ADDRESS="198\.18\.0\.2"/);
  assert.match(source,/addAddress\("198\.18\.0\.1",30\)/);
  assert.match(source,/addDnsServer\(VPN_DNS_ADDRESS\)/);
  assert.equal((source.match(/addDnsServer\(/g)||[]).length,1);
});

test('Android intercepts DNS before rejecting other traffic to its resolver',()=>{
  const dns=source.indexOf('new JSONArray().put("DST-PORT,53,Zphone-DNS")');
  const guard=source.indexOf('rules.put("IP-CIDR,"+VPN_DNS_ADDRESS+"/32,REJECT,no-resolve")');
  const ipv6=source.indexOf('rules.put("IP-CIDR6,::/0,REJECT,no-resolve")');
  const udp=source.indexOf('rules.put("NETWORK,udp,REJECT")');
  const fallback=source.indexOf('rules.put("MATCH,Zphone-Test")');
  assert(dns>=0&&guard>dns&&ipv6>guard&&udp>ipv6&&fallback>udp);
  assert.match(source,/put\("name","Zphone-DNS"\)\.put\("type","dns"\)/);
});

test('Android retains protected upstream DNS and exit IPv6 capabilities',()=>{
  assert.match(source,/put\("ipv6",Protocols\.supportsIpv6\(p\)\)/);
  assert.match(source,/put\("respect-rules",true\)/);
  assert.match(source,/put\("nameserver",new JSONArray\(\)\.put\("https:\/\/1\.1\.1\.1\/dns-query"\)\.put\("https:\/\/1\.0\.0\.1\/dns-query"\)\)/);
  assert(!source.includes('private_dns_mode'));
});
