// ISO 3166-1 alpha-2 + alpha-3 records; no reserved or withdrawn codes.
// Source: https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/supplemental/supplementalData.xml
// Keep the Android catalog identical; the parity test checks every record.
export const COUNTRY_RECORDS=`
ADAND AEARE AFAFG AGATG AIAIA ALALB AMARM AOAGO AQATA ARARG ASASM ATAUT AUAUS AWABW AXALA AZAZE
BABIH BBBRB BDBGD BEBEL BFBFA BGBGR BHBHR BIBDI BJBEN BLBLM BMBMU BNBRN BOBOL BQBES BRBRA BSBHS
BTBTN BVBVT BWBWA BYBLR BZBLZ CACAN CCCCK CDCOD CFCAF CGCOG CHCHE CICIV CKCOK CLCHL CMCMR CNCHN
COCOL CRCRI CUCUB CVCPV CWCUW CXCXR CYCYP CZCZE DEDEU DJDJI DKDNK DMDMA DODOM DZDZA ECECU EEEST
EGEGY EHESH ERERI ESESP ETETH FIFIN FJFJI FKFLK FMFSM FOFRO FRFRA GAGAB GBGBR GDGRD GEGEO GFGUF
GGGGY GHGHA GIGIB GLGRL GMGMB GNGIN GPGLP GQGNQ GRGRC GSSGS GTGTM GUGUM GWGNB GYGUY HKHKG HMHMD
HNHND HRHRV HTHTI HUHUN IDIDN IEIRL ILISR IMIMN ININD IOIOT IQIRQ IRIRN ISISL ITITA JEJEY JMJAM
JOJOR JPJPN KEKEN KGKGZ KHKHM KIKIR KMCOM KNKNA KPPRK KRKOR KWKWT KYCYM KZKAZ LALAO LBLBN LCLCA
LILIE LKLKA LRLBR LSLSO LTLTU LULUX LVLVA LYLBY MAMAR MCMCO MDMDA MEMNE MFMAF MGMDG MHMHL MKMKD
MLMLI MMMMR MNMNG MOMAC MPMNP MQMTQ MRMRT MSMSR MTMLT MUMUS MVMDV MWMWI MXMEX MYMYS MZMOZ NANAM
NCNCL NENER NFNFK NGNGA NINIC NLNLD NONOR NPNPL NRNRU NUNIU NZNZL OMOMN PAPAN PEPER PFPYF PGPNG
PHPHL PKPAK PLPOL PMSPM PNPCN PRPRI PSPSE PTPRT PWPLW PYPRY QAQAT REREU ROROU RSSRB RURUS RWRWA
SASAU SBSLB SCSYC SDSDN SESWE SGSGP SHSHN SISVN SJSJM SKSVK SLSLE SMSMR SNSEN SOSOM SRSUR SSSSD
STSTP SVSLV SXSXM SYSYR SZSWZ TCTCA TDTCD TFATF TGTGO THTHA TJTJK TKTKL TLTLS TMTKM TNTUN TOTON
TRTUR TTTTO TVTUV TWTWN TZTZA UAUKR UGUGA UMUMI USUSA UYURY UZUZB VAVAT VCVCT VEVEN VGVGB VIVIR
VNVNM VUVUT WFWLF WSWSM YEYEM YTMYT ZAZAF ZMZMB ZWZWE
`.trim().split(/\s+/);
Object.freeze(COUNTRY_RECORDS);
export const COUNTRIES=Object.freeze(COUNTRY_RECORDS.map(record=>record.slice(0,2)));
const countries=new Set(COUNTRIES);
const locations=new Map(COUNTRY_RECORDS.flatMap(record=>[[record.slice(0,2),record.slice(0,2)],[record.slice(2),record.slice(0,2)]]));
locations.set('AMS','NL');
const legacy=new Set(['FIN','AMS','DEU']);
export const LOCATION_CODES=Object.freeze([...locations.keys()]);
export const isCountry=value=>typeof value==='string'&&countries.has(value);
export const isLocation=value=>typeof value==='string'&&locations.has(value);
export const isLocationSelection=value=>value==='auto'||isLocation(value);

export function profileCountry(profile){
  if(!profile||!isLocation(profile.location))throw Error('Invalid location');
  const inferred=locations.get(profile.location);
  if(!Object.hasOwn(profile,'country'))return inferred;
  if(!isCountry(profile.country)||(!legacy.has(profile.location)&&profile.country!==inferred))throw Error('Invalid country metadata');
  return profile.country;
}

export function availableLocations(profiles){
  const found=new Map();
  for(const profile of profiles){
    const country=profileCountry(profile),previous=found.get(profile.location);
    if(previous&&previous.country!==country)throw Error('Conflicting location countries');
    if(!previous)found.set(profile.location,{location:profile.location,country});
  }
  return [...found.values()];
}

const displayNames=new Map();
export function countryName(country,locale='ru'){
  if(!isCountry(country))throw Error('Invalid country');
  try{
    if(!displayNames.has(locale))displayNames.set(locale,new Intl.DisplayNames([locale],{type:'region',fallback:'code'}));
    return displayNames.get(locale).of(country)||country;
  }catch{return country;}
}
export function locationName(profile,locale='ru'){
  return countryName(profileCountry(profile),locale);
}
export function countryFlag(country){
  if(!isCountry(country))throw Error('Invalid country');
  return `./flags/${country.toLowerCase()}.png`;
}
