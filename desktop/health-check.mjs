export const HEALTH_TARGETS=Object.freeze([
  'https://www.gstatic.com/generate_204',
  'https://cp.cloudflare.com/generate_204',
  'https://www.apple.com/library/test/success.html',
]);

export async function checkHealth({request,valid=()=>true,record=()=>{}}){
  const results=await Promise.all(HEALTH_TARGETS.map(async(url,index)=>{
    const start=Date.now();
    let facts;
    try{
      const latency=await request(url);
      if(!Number.isFinite(latency)||latency<0)throw Error('Invalid latency');
      facts={ok:true,latency};
    }catch(error){facts={ok:false,errorCode:error.code||'NETWORK_ERROR'};}
    if(!valid())facts={ok:false,reason:'cancelled'};
    record({stage:'health',attempt:index+1,transport:'proxy',phase:'request',durationMs:Date.now()-start,...facts});
    return facts;
  }));
  if(!valid())throw Object.assign(Error('Connection changed'),{code:'ECANCELED'});
  const reachable=results.filter(result=>result.ok);
  if(!reachable.length)throw Object.assign(Error('All connectivity checks failed'),{code:'ENETUNREACH'});
  return Math.min(...reachable.map(result=>result.latency));
}
