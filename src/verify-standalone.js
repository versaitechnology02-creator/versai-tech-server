
const axios = require("axios");

// Mock Config
const UNPAY_PARTNER_ID = "12345";
const UNPAY_API_KEY = "test-api-key";
process.env.UNPAY_WEBHOOK_URL = "https://example.com/callback";

// Mock Client
const unpayClient = axios.create({
    baseURL: "https://unpay.in/tech/api",
    headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": UNPAY_API_KEY, // Verify header here
    },
});

// Interceptor to capture request
unpayClient.interceptors.request.use((config) => {
    console.log("\n[VERIFICATION] Final Request Headers:");
    console.log(JSON.stringify(config.headers, null, 2));

    console.log("\n[VERIFICATION] Final Request Body (Data):");
    console.log(JSON.stringify(config.data, null, 2));

    console.log("\n[VERIFICATION] Request URL:", config.baseURL + config.url);

    // Block actual network call
    throw new Error("VERIFICATION_COMPLETE");
});

// COPY OF THE FUNCTION TO TEST (Exact logic from src/services/unpay.ts converted to JS)
async function createUnpayDynamicQR(payload) {
    if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
        throw new Error("UnPay credentials missing")
    }

    const amount = Number(payload.amount)

    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("Invalid amount")
    }

    const webhook =
        payload.webhook || process.env.UNPAY_WEBHOOK_URL

    if (!webhook) {
        throw new Error("Webhook missing")
    }

    // ======================
    // Build Strict Payload
    // ======================
    const info = {
        partner_id: Number(UNPAY_PARTNER_ID) || UNPAY_PARTNER_ID,
        amount: amount,
        apitxnid: payload.apitxnid,
        webhook,
    }

    console.log("[UnPay QR] Request Body:", JSON.stringify(info, null, 2))

    // ======================
    // Send Request
    // ======================
    try {
        const resp = await unpayClient.post(
            "/next/upi/request/qr",
            info
        )

        console.log("[UnPay QR] Response:", resp.data)

        if (resp.data?.status !== "TXN") {
            throw new Error(
                resp.data?.message || "QR failed"
            )
        }

        return {
            apitxnid: resp.data.data.apitxnid,
            qrString: resp.data.data.qrString,
            time: resp.data.data.time,
        }
    } catch (err) {
        if (err.message === "VERIFICATION_COMPLETE") throw err;
        console.error(
            "[UnPay QR] Error:",
            err.response?.data || err.message
        )

        throw new Error("UnPay Dynamic QR failed")
    }
}

// Run Test
async function run() {
    try {
        await createUnpayDynamicQR({
            amount: 100,
            apitxnid: "order_test_123",
            webhook: "https://mysite.com/hook",
            customer_email: "ignore@me.com",
        });
    } catch (err) {
        if (err.message === "VERIFICATION_COMPLETE") {
            console.log("\n--- VERIFICATION SUCCESSFUL ---");
        } else {
            console.error("\n--- VERIFICATION FAILED ---");
            console.error(err);
        }
    }
}

run();
