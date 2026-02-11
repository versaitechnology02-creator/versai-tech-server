
import unpayClient from "./config/unpay";
import { createUnpayDynamicQR } from "./services/unpay";

// Mock environment variables if needed (though config/unpay might have read them already)
process.env.UNPAY_PARTNER_ID = "12345";
process.env.UNPAY_API_KEY = "test-api-key";
process.env.UNPAY_WEBHOOK_URL = "https://example.com/callback";

async function verify() {
    console.log("--- STARTING VERIFICATION ---");

    // Add interceptor to capture request details
    unpayClient.interceptors.request.use((config) => {
        console.log("\n[VERIFICATION] Final Request Headers:");
        console.log(JSON.stringify(config.headers, null, 2));

        console.log("\n[VERIFICATION] Final Request Body (Data):");
        console.log(JSON.stringify(config.data, null, 2));

        console.log("\n[VERIFICATION] Request URL:", (config.baseURL ?? "") + (config.url ?? ""));

        // Block actual network call
        throw new Error("VERIFICATION_COMPLETE");
    });

    try {
        await createUnpayDynamicQR({
            amount: 100,
            apitxnid: "order_test_123",
            webhook: "https://mysite.com/hook",
            // These should be ignored/not present in final payload
        });
    } catch (err: any) {
        if (err.message === "VERIFICATION_COMPLETE") {
            console.log("\n--- VERIFICATION SUCCESSFUL: Request captured ---");
        } else {
            console.error("\n--- VERIFICATION FAILED ---");
            console.error(err);
        }
    }
}

verify();
