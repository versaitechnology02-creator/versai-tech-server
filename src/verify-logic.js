
// Mock Env
const UNPAY_PARTNER_ID = "12345";
const UNPAY_API_KEY = "test-api-key";
process.env.UNPAY_WEBHOOK_URL = "https://example.com/callback";

// Mock Client
const unpayClient = {
    post: async (url, data) => {
        console.log("\n[VERIFICATION] Final Request Headers (Simulated):");
        console.log(JSON.stringify({
            "Content-Type": "application/json",
            "Accept": "application/json",
            "api-key": UNPAY_API_KEY
        }, null, 2));

        console.log("\n[VERIFICATION] Final Request Body (Data):");
        console.log(JSON.stringify(data, null, 2));

        console.log("\n[VERIFICATION] Request URL:", "https://unpay.in/tech/api" + url);

        return { data: { status: "TXN", data: { apitxnid: "123", qrString: "upi://test", time: "now" } } };
    }
};

// COPY OF THE FUNCTION TO TEST (Exact logic from src/services/unpay.ts)
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
    // Per UnPay Docs & Client Feedback:
    // - No IP
    // - No customer_email
    // - amount as integer
    // - Only required fields
    const info = {
        partner_id: Number(UNPAY_PARTNER_ID) || UNPAY_PARTNER_ID, // Ensure type matches doc if possible, usually string or int. User said integer.
        amount: amount, // Send as number/integer
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
        console.log("\n--- VERIFICATION SUCCESSFUL ---");
    } catch (err) {
        console.error("\n--- VERIFICATION FAILED ---");
        console.error(err);
    }
}

run();
