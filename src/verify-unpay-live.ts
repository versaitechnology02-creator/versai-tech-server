
require('dotenv').config();
import { createUnpayDynamicQR } from "./services/unpay";

async function runTest() {
    console.log("--- START LIVE VERIFICATION ---\n");

    // Mock env if missing for test structure (though real env is preferred)
    if (!process.env.UNPAY_API_KEY) {
        console.warn("⚠️ UNPAY_API_KEY missing in env, using MOCK for structure check");
        process.env.UNPAY_API_KEY = "MOCK_API_KEY";
        process.env.UNPAY_PARTNER_ID = "1234";
        process.env.UNPAY_AES_KEY = "12345678901234567890123456789012";
        process.env.UNPAY_WEBHOOK_URL = "http://localhost/webhook";
        process.env.UNPAY_BASE_URL = "https://unpay.in/tech/api";
    }

    try {
        console.log("Calling createUnpayDynamicQR...");
        await createUnpayDynamicQR({
            amount: 100,
            apitxnid: "TEST_" + Date.now(),
            webhook: "http://test.com/callback"
        });
    } catch (err: any) {
        console.log("\n❌ CALL FAILED (Expected if credentials are mock/prod is not reachable)");
        console.log("Error Message:", err.message);

        // We only care about the LOGS generated BEFORE the error/success
        // The logs inside createUnpayDynamicQR are what verify the structure.
    }

    console.log("\n--- END LIVE VERIFICATION ---");
}

runTest();
