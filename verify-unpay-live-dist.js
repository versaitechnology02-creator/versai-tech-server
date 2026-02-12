
const unpay = require('./dist/services/unpay.js');
const dotenv = require('dotenv');
dotenv.config();

// Ensure mock env vars for logs to appear
if (!process.env.UNPAY_API_KEY) process.env.UNPAY_API_KEY = "MOCK_API_KEY_FOR_LOGS";
if (!process.env.UNPAY_AES_KEY) process.env.UNPAY_AES_KEY = "12345678901234567890123456789012";
if (!process.env.UNPAY_PARTNER_ID) process.env.UNPAY_PARTNER_ID = "1234";
if (!process.env.UNPAY_WEBHOOK_URL) process.env.UNPAY_WEBHOOK_URL = "http://test";

async function run() {
    console.log("--- DIST JS VERIFICATION START ---");
    try {
        await unpay.createUnpayDynamicQR({
            amount: 100,
            apitxnid: "TEST_DIST_" + Date.now(),
            webhook: "http://test.com"
        });
    } catch (e) {
        console.log("Error ignoring (expected):", e.message);
    }
    console.log("--- DIST JS VERIFICATION END ---");
}

run();
