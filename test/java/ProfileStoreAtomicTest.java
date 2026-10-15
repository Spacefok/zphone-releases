package org.zphone.pilot;

import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;

public class ProfileStoreAtomicTest {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args) throws Exception {
        File root=new File(args[0]),vault=new File(root,"vault.enc");
        byte[] old={1,2,3,4},next={5,6,7,8};
        ProfileStore.atomicReplace(vault,old);
        boolean failed=false;
        try{ProfileStore.atomicReplace(vault,null);}catch(Exception expected){failed=true;}
        check(failed&&Arrays.equals(Files.readAllBytes(vault.toPath()),old));
        ProfileStore.atomicReplace(vault,next);
        check(Arrays.equals(Files.readAllBytes(vault.toPath()),next));
        File directory=new File(root,"cannot-replace");check(directory.mkdir());
        File retained=new File(directory,"old.enc");Files.write(retained.toPath(),old);
        failed=false;try{ProfileStore.atomicReplace(directory,next);}catch(Exception expected){failed=true;}
        check(failed&&Arrays.equals(Files.readAllBytes(retained.toPath()),old));
        check(Arrays.stream(root.list()).noneMatch(name->name.startsWith(".profile-")));
        System.out.println("Atomic vault: 4 checks passed");
    }
}
