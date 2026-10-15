package org.zphone.pilot;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class Countries {
    // ISO alpha-2 + alpha-3; kept in sync with shared/countries.mjs by tests.
    static final String RECORDS=
        "ADAND AEARE AFAFG AGATG AIAIA ALALB AMARM AOAGO AQATA ARARG ASASM ATAUT AUAUS AWABW AXALA AZAZE "+
        "BABIH BBBRB BDBGD BEBEL BFBFA BGBGR BHBHR BIBDI BJBEN BLBLM BMBMU BNBRN BOBOL BQBES BRBRA BSBHS "+
        "BTBTN BVBVT BWBWA BYBLR BZBLZ CACAN CCCCK CDCOD CFCAF CGCOG CHCHE CICIV CKCOK CLCHL CMCMR CNCHN "+
        "COCOL CRCRI CUCUB CVCPV CWCUW CXCXR CYCYP CZCZE DEDEU DJDJI DKDNK DMDMA DODOM DZDZA ECECU EEEST "+
        "EGEGY EHESH ERERI ESESP ETETH FIFIN FJFJI FKFLK FMFSM FOFRO FRFRA GAGAB GBGBR GDGRD GEGEO GFGUF "+
        "GGGGY GHGHA GIGIB GLGRL GMGMB GNGIN GPGLP GQGNQ GRGRC GSSGS GTGTM GUGUM GWGNB GYGUY HKHKG HMHMD "+
        "HNHND HRHRV HTHTI HUHUN IDIDN IEIRL ILISR IMIMN ININD IOIOT IQIRQ IRIRN ISISL ITITA JEJEY JMJAM "+
        "JOJOR JPJPN KEKEN KGKGZ KHKHM KIKIR KMCOM KNKNA KPPRK KRKOR KWKWT KYCYM KZKAZ LALAO LBLBN LCLCA "+
        "LILIE LKLKA LRLBR LSLSO LTLTU LULUX LVLVA LYLBY MAMAR MCMCO MDMDA MEMNE MFMAF MGMDG MHMHL MKMKD "+
        "MLMLI MMMMR MNMNG MOMAC MPMNP MQMTQ MRMRT MSMSR MTMLT MUMUS MVMDV MWMWI MXMEX MYMYS MZMOZ NANAM "+
        "NCNCL NENER NFNFK NGNGA NINIC NLNLD NONOR NPNPL NRNRU NUNIU NZNZL OMOMN PAPAN PEPER PFPYF PGPNG "+
        "PHPHL PKPAK PLPOL PMSPM PNPCN PRPRI PSPSE PTPRT PWPLW PYPRY QAQAT REREU ROROU RSSRB RURUS RWRWA "+
        "SASAU SBSLB SCSYC SDSDN SESWE SGSGP SHSHN SISVN SJSJM SKSVK SLSLE SMSMR SNSEN SOSOM SRSUR SSSSD "+
        "STSTP SVSLV SXSXM SYSYR SZSWZ TCTCA TDTCD TFATF TGTGO THTHA TJTJK TKTKL TLTLS TMTKM TNTUN TOTON "+
        "TRTUR TTTTO TVTUV TWTWN TZTZA UAUKR UGUGA UMUMI USUSA UYURY UZUZB VAVAT VCVCT VEVEN VGVGB VIVIR "+
        "VNVNM VUVUT WFWLF WSWSM YEYEM YTMYT ZAZAF ZMZMB ZWZWE";
    private static final Set<String> COUNTRIES=new HashSet<>();
    private static final Map<String,String> LOCATIONS=new HashMap<>();
    static {
        for(String record:RECORDS.split(" ")){
            String country=record.substring(0,2);COUNTRIES.add(country);
            LOCATIONS.put(country,country);LOCATIONS.put(record.substring(2),country);
        }
        LOCATIONS.put("AMS","NL");
    }
    static boolean isCountry(Object value){return value instanceof String&&COUNTRIES.contains(value);}
    static boolean isLocation(Object value){return value instanceof String&&LOCATIONS.containsKey(value);}
    static boolean isSelection(Object value){return "auto".equals(value)||isLocation(value);}
    static Set<String> locationCodes(){return Collections.unmodifiableSet(LOCATIONS.keySet());}
    static String country(Object location,boolean supplied,Object metadata){
        if(!isLocation(location))throw new IllegalArgumentException("Invalid location");
        String inferred=LOCATIONS.get(location);
        if(!supplied)return inferred;
        boolean legacy="FIN".equals(location)||"AMS".equals(location)||"DEU".equals(location);
        if(!isCountry(metadata)||(!legacy&&!inferred.equals(metadata)))throw new IllegalArgumentException("Invalid country metadata");
        return (String)metadata;
    }
    static void consistent(Map<String,String> countries,String location,String country){
        String previous=countries.putIfAbsent(location,country);
        if(previous!=null&&!previous.equals(country))throw new IllegalArgumentException("Conflicting location countries");
    }
    static String name(String country){
        if(!isCountry(country))throw new IllegalArgumentException("Invalid country");
        String name=new Locale("",country).getDisplayCountry(new Locale("ru"));
        return name.isEmpty()?country:name;
    }
}
