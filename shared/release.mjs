import {createPublicKey,verify,createHash} from 'node:crypto';
import {compareVersion} from './profiles.mjs';

export function releaseAssetUrl(value,repository){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||url.hostname!=='github.com'||!url.pathname.startsWith(`/${repository}/releases/download/`)||url.pathname.includes('..'))throw Error('Invalid release URL');
  return url.href;
}
export function verifyRelease(envelope,{publicKey,repository,channel='test',now=Date.now(),platform='windows-x64'}={}){
  if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>44000||typeof envelope.signature!=='string'||envelope.signature.length>1024)throw Error('Invalid signed release');
  const payload=Buffer.from(envelope.payload,'base64'),key=createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072||!verify('RSA-SHA256',payload,key,Buffer.from(envelope.signature,'base64')))throw Error('Release signature rejected');
  const release=JSON.parse(payload.toString('utf8'));
  if(release.format!=='zphone-release-v1'||release.channel!==channel||!Number.isFinite(Date.parse(release.expires))||Date.parse(release.expires)<=now||!Number.isFinite(Date.parse(release.published))||Date.parse(release.published)>now+300000)throw Error('Invalid release lifetime or channel');
  compareVersion(release.version,'0.0.0');
  if(typeof release.notes!=='string'||release.notes.length>4000)throw Error('Invalid release notes');
  const priority=release.priority??'normal';
  if(!['normal','important','critical'].includes(priority))throw Error('Invalid release priority');
  const asset=release.assets?.[platform];
  if(!asset||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>1024*1024*1024||!/^[a-f0-9]{64}$/.test(asset.sha256)||!/^[A-Za-z0-9+/]{86}==$/.test(asset.sha512))throw Error('Invalid release artifact');
  releaseAssetUrl(asset.url,repository);
  if(platform==='android-arm64'&&(!Number.isSafeInteger(asset.versionCode)||asset.versionCode<1||asset.package!=='org.zphone.preview'))throw Error('Invalid Android release');
  return {...release,priority,asset};
}
export function verifyArtifact(bytes,asset){
  if(bytes.length!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256||createHash('sha512').update(bytes).digest('base64')!==asset.sha512)throw Error('Release file rejected');
}
export async function readJson(response,limit=65536){
  if(!response.ok)throw Error('Service unavailable');
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Response too large');chunks.push(Buffer.from(chunk));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
