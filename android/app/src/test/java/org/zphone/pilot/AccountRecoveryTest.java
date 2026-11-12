package org.zphone.pilot;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import static org.junit.Assert.*;

public class AccountRecoveryTest {
    @Test public void stableProofIgnoresEndpoint() throws Exception {
        JSONObject profile=new JSONObject().put("protocol","AmneziaWG").put("privateKey","a".repeat(43)+"=").put("server","192.0.2.1");
        JSONObject bundle=new JSONObject().put("profiles",new JSONArray().put(profile));
        String proof=AccountRecovery.proof(bundle);assertEquals(64,proof.length());
        profile.put("server","192.0.2.2");assertEquals(proof,AccountRecovery.proof(bundle));
        assertNull(AccountRecovery.proof(null));assertNull(AccountRecovery.proof(new JSONObject()));
        profile.put("privateKey","invalid");assertNull(AccountRecovery.proof(bundle));
    }
}
