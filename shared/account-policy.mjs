export function accessEndpoints(config){
  const values=config?.baseUrls??[config?.baseUrl];
  if(!Array.isArray(values)||!values.length||values.length>3)throw Error('Invalid access service');
  return [...new Set(values.map(value=>{
    if(typeof value!=='string')throw Error('Invalid access service');
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Invalid access service');
    return url.origin;
  }))];
}

export function canRetryAccess(route,error){
  if(error.status===401||error.status===403||error.status===429||error.received)return false;
  const beforeSend=/^(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|DNS_NO_PUBLIC_ADDRESS)$/.test(error.code||'')||/CERT|TLS|SSL/.test(error.code||'');
  if(route.endsWith('/redeem')||route.endsWith('/logout'))return !error.status&&beforeSend;
  if(error.status)return [502,503,504].includes(error.status);
  return beforeSend||/^(?:ETIMEDOUT|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_SOCKET|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_TIMED_OUT|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|NETWORK_ERROR|TypeError)$/.test(error.code||'');
}
