package org.zphone.pilot;

import java.util.HashMap;

public final class CountriesTest {
    private static void check(boolean value){if(!value)throw new AssertionError();}
    private static void rejects(Runnable action){try{action.run();}catch(IllegalArgumentException expected){return;}throw new AssertionError("Accepted invalid metadata");}
    public static void main(String[] args){
        check(Countries.RECORDS.split(" ").length==249);check(Countries.locationCodes().size()==499);
        for(String record:Countries.RECORDS.split(" ")){
            String country=record.substring(0,2),location=record.substring(2);
            check(Countries.isCountry(country));check(Countries.isLocation(location));
            check(country.equals(Countries.country(location,false,null)));
            check(country.equals(Countries.country(country,true,country)));
            check(!Countries.name(country).isEmpty());
        }
        check(Countries.country("AMS",false,null).equals("NL"));
        check(Countries.country("DEU",true,"CZ").equals("CZ"));
        check(Countries.isSelection("auto"));check(!Countries.isSelection("AUTO"));
        for(Object invalid:new Object[]{null,42,true,new String[]{"CZ"},"cz","CZE","ZZ","XK","EU","<img>","https://test.example"}){
            check(!Countries.isCountry(invalid));rejects(()->Countries.country("DEU",true,invalid));
        }
        for(Object invalid:new Object[]{null,42,true,"auto","cz","AN","SUN","XK","EU","CZ-PRG","../../CZ","<img>"}){
            check(!Countries.isLocation(invalid));rejects(()->Countries.country(invalid,false,null));
        }
        rejects(()->Countries.country("CZ",true,"US"));
        HashMap<String,String> locations=new HashMap<>();
        for(int i=0;i<5;i++)Countries.consistent(locations,"DEU","CZ");
        check(locations.size()==1);rejects(()->Countries.consistent(locations,"DEU","DE"));
        System.out.println("Android country catalog and metadata policy passed");
    }
}
