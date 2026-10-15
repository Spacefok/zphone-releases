import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {Resolver} from 'node:dns/promises';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {coreConfig} from '../shared/profiles.mjs';
import {freePort} from '../desktop/engine.mjs';

const output=process.argv[2];
if(!output)throw Error('QA output directory required');
const root=path.resolve(import.meta.dirname,'..');
const binary=path.join(root,'runtime/windows/mihomo.exe');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-ipv6-dns-'));
const run=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const secret='local-ipv6-dns-test-credential',queries=[];
const upstream=dgram.createSocket('udp4');

// A deterministic dual-stack DNS fixture. No real profiles or external DNS are used.
upstream.on('message',(request,peer)=>{
  if(request.length<17||request.readUInt16BE(4)!==1)return;
  let end=12;
  while(end<request.length&&request[end]>0){
    if(request[end]>63)return;
    end+=request[end]+1;
  }
  end+=5;
  if(end>request.length)return;
  const type=request.readUInt16BE(end-4);
  queries.push(type);
  const value=type===1?Buffer.from([192,0,2,42]):type===28?Buffer.from('20010db8000000000000000000000042','hex'):null;
  const header=Buffer.alloc(12);
  header.writeUInt16BE(request.readUInt16BE(0));header.writeUInt16BE(0x8180,2);
  header.writeUInt16BE(1,4);header.writeUInt16BE(value?1:0,6);
  const answer=Buffer.alloc(value?12+value.length:0);
  if(value){
    answer.writeUInt16BE(0xc00c);answer.writeUInt16BE(type,2);answer.writeUInt16BE(1,4);
    answer.writeUInt32BE(60,6);answer.writeUInt16BE(value.length,10);value.copy(answer,12);
  }
  upstream.send(Buffer.concat([header,request.subarray(12,end),answer]),peer.port,peer.address);
});

async function stop(child){
  if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
  const exited=once(child,'exit');
  child.kill();await exited;
}

const results=[];
try{
  upstream.bind(0,'127.0.0.1');await once(upstream,'listening');
  const resolver=`udp://127.0.0.1:${upstream.address().port}#DIRECT`;
  const key=Buffer.alloc(32,1).toString('base64');
  const base={id:'fixture',location:'FIN',server:'192.0.2.1',port:443,username:'fixture',password:'fixture-only'};
  const profiles=[
    {...base,protocol:'AmneziaWG',ipv6:true,ip:'10.0.0.2',mtu:1280,privateKey:key,publicKey:key,presharedKey:key,awg:{version:3,'header-protection-key':key}},
    {...base,protocol:'Mieru',ipv6:false},
    {...base,protocol:'Mieru',ipv6:true},
  ];
  for(const profile of profiles){
    for(const mode of ['all','exclude','include']){
      const expectedIpv6=profile.ipv6&&profile.protocol!=='AmneziaWG';
      const port=await freePort(),apiPort=await freePort(),dnsPort=await freePort();
      const split={mode,apps:mode==='all'?[]:[{id:'C:\\QA\\Browser.exe',name:'Fixture'}]};
      const config=coreConfig(profile,{port,apiPort,secret,mode:'vpn',split});
      assert.equal(config.ipv6,true);
      // Keep generated DNS/routing policy but never start TUN or connect a VPN endpoint.
      config.tun.enable=false;
      config.proxies=[{name:'Zphone-Test',type:'direct'}];
      Object.assign(config.dns,{listen:`127.0.0.1:${dnsPort}`,nameserver:[resolver],'default-nameserver':[resolver],'proxy-server-nameserver':[resolver],'use-hosts':false,'use-system-hosts':false});
      const file=path.join(directory,`case-${results.length}.json`);
      await fs.writeFile(file,JSON.stringify(config));
      await run(binary,['-t','-d',directory,'-f',file],{windowsHide:true,timeout:15000});
      const core=spawn(binary,['-d',directory,'-f',file],{windowsHide:true,stdio:['ignore','ignore','pipe']});
      let coreError='',spawnError;
      core.stderr.on('data',chunk=>{coreError=(coreError+chunk).slice(-2000);});
      core.on('error',error=>{spawnError=error;});
      try{
        let ready=false;
        for(let i=0;i<60;i++){
          if(spawnError)throw spawnError;
          if(core.exitCode!==null)throw Error(`Core exited: ${coreError}`);
          try{
            const response=await fetch(`http://127.0.0.1:${apiPort}/configs`,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(500)});
            if(response.ok){assert.equal((await response.json()).tun.enable,false);ready=true;break;}
          }catch{}
          await pause(100);
        }
        assert(ready,'Isolated core must start');
        const client=new Resolver({timeout:2000,tries:1});
        client.setServers([`127.0.0.1:${dnsPort}`]);
        const before=queries.length;
        assert.deepEqual(await client.resolve4('ipv6-qa.test'),['192.0.2.42']);
        let aaaa=[];
        try{aaaa=await client.resolve6('ipv6-qa.test');}catch(error){if(error.code!=='ENODATA')throw error;}
        assert.deepEqual(aaaa,expectedIpv6?['2001:db8::42']:[]);
        assert.equal(queries.slice(before).includes(28),expectedIpv6,'Unsupported AAAA must not reach upstream');
        results.push({protocol:profile.protocol,declaredIpv6:profile.ipv6,split:mode,ipv4Resolved:true,aaaaReturned:aaaa.length,passed:true});
      }finally{await stop(core);}
    }
  }
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'ipv6-dns.json'),JSON.stringify({systemTunStarted:false,externalTraffic:false,results},null,2));
  console.log(JSON.stringify(results,null,2));
}finally{
  await new Promise(resolve=>upstream.close(resolve));
  const resolved=await fs.realpath(directory),temporary=await fs.realpath(os.tmpdir());
  assert(resolved.startsWith(temporary+path.sep+'zphone-ipv6-dns-'));
  await fs.rm(resolved,{recursive:true,force:true});
}
