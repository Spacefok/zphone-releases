import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

export function conflictingAdapters({adapters,routedInterfaces}) {
  if(!Array.isArray(adapters)||!Array.isArray(routedInterfaces)||!routedInterfaces.length)throw Error('Cannot verify the current network route');
  return adapters.filter(adapter=>{
    if(adapter.Status!=='Up')return false;
    const description=adapter.InterfaceDescription||'',name=adapter.Name||'';
    if(!/Amnezia|WireGuard|Wintun|OpenVPN|\b(?:TAP|VPN|TUN|Tunnel)\b/i.test(description+' '+name))return false;
    // Radmin is an auxiliary LAN unless Windows selects it for Internet traffic.
    if(description==='Famatech Radmin VPN Ethernet Adapter'&&!routedInterfaces.includes(adapter.ifIndex))return false;
    return true;
  });
}

export async function windowsNetworkStatus() {
  const script=`$ErrorActionPreference='Stop'
$a=@(Get-NetAdapter -IncludeHidden | Select-Object Name,InterfaceDescription,Status,ifIndex)
$v4=@(Find-NetRoute -RemoteIPAddress 1.1.1.1 | Select-Object -ExpandProperty InterfaceIndex)
$v6=@(Find-NetRoute -RemoteIPAddress 2001:4860:4860::8888 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty InterfaceIndex)
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
@{adapters=$a;routedInterfaces=@(($v4+$v6)|Select-Object -Unique);admin=$admin}|ConvertTo-Json -Compress -Depth 4`;
  const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000});
  const state=JSON.parse(result.stdout);
  return {...state,conflicts:conflictingAdapters(state)};
}

export async function windowsNetworkDiagnostics() {
  const script=`$ErrorActionPreference='Stop'
$adapters=@(Get-NetAdapter -IncludeHidden | Where-Object {$_.Status -eq 'Up' -or $_.Name -eq 'ZphoneTest'} | Select-Object Name,InterfaceDescription,Status,ifIndex)
$interfaces=@(Get-NetIPInterface | Where-Object {$_.ConnectionState -eq 'Connected'} | Select-Object InterfaceAlias,InterfaceIndex,AddressFamily,NlMtu,InterfaceMetric)
$dns=@(Get-DnsClientServerAddress | Where-Object {$_.ServerAddresses.Count -gt 0} | Select-Object InterfaceAlias,InterfaceIndex,AddressFamily,ServerAddresses)
$v4=@(Find-NetRoute -RemoteIPAddress 1.1.1.1 -ErrorAction SilentlyContinue | Where-Object {$_.DestinationPrefix} | Select-Object InterfaceAlias,InterfaceIndex,DestinationPrefix,NextHop,RouteMetric)
$v6=@(Find-NetRoute -RemoteIPAddress 2001:4860:4860::8888 -ErrorAction SilentlyContinue | Where-Object {$_.DestinationPrefix} | Select-Object InterfaceAlias,InterfaceIndex,DestinationPrefix,NextHop,RouteMetric)
$counters=@(Get-NetAdapterStatistics -Name ZphoneTest -ErrorAction SilentlyContinue | Select-Object Name,ReceivedBytes,SentBytes,ReceivedDiscardedPackets,OutboundDiscardedPackets,ReceivedPacketErrors,OutboundPacketErrors)
@{adapters=$adapters;interfaces=$interfaces;dns=$dns;ipv4Route=$v4;ipv6Route=$v6;tunCounters=$counters}|ConvertTo-Json -Compress -Depth 5`;
  const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000});
  return JSON.parse(result.stdout);
}
