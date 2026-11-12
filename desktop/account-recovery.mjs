import {createHash} from 'node:crypto';

export function recoveryProof(bundle){
  const profile=bundle?.profiles?.find(p=>p.protocol==='AmneziaWG'&&/^[A-Za-z0-9+/]{43}=$/.test(p.privateKey||''));
  return profile?createHash('sha256').update('zphone-reauth-v1:'+profile.privateKey).digest('hex'):undefined;
}
