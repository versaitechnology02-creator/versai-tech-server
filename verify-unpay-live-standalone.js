const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const axios = require('axios');

// 1. Load ENV
const envPath = path.resolve(__dirname, '.env');
const envConfig = {};
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            envConfig[key.trim()] = value.trim();
        }
    });
} else {
    console.error("❌ .env file not found!");
    process.exit(1);
}

const PARTNER_ID = envConfig.UNPAY_PARTNER_ID;
const API_KEY = envConfig.UNPAY_API_KEY;
const AES_KEY = envConfig.UNPAY_AES_KEY;
const BASE_URL = envConfig.UNPAY_BASE_URL || "https://unpay.in/tech/api";
const WEBHOOK = envConfig.UNPAY_WEBHOOK_URL || "https://example.com/webhook";

console.log("--- CONFIG CHECK ---");
console.log("Partner ID:", PARTNER_ID);
console.log("API Key:", API_KEY ? (API_KEY.substring(0, 5) + "...") : "MISSING");
console.log("AES Key Length (Env):", AES_KEY ? AES_KEY.length : 0);

if (!AES_KEY || AES_KEY.length < 16) {
    console.error("❌ CRITICAL: AES Key too short.");
    process.exit(1);
}

// 2. Encryption Logic (TESTING AES-128)
function encryptAES(data) {
    // FORCE 16 BYTE KEY
    const key = Buffer.from(AES_KEY.substring(0, 16), 'utf8');

    // FORCE AES-128-ECB
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted.toUpperCase(); // Trying Uppercase Hex with AES-128
}

// 3. Main Test
async function runTest() {
    try {
        console.log("\n--- PREPARING REQUEST (AES-128-ECB) ---");
        const orderId = `TEST_${Date.now()}`;

        // Use String Partner ID
        const innerPayload = {
            partner_id: Number(PARTNER_ID), // Reverting to Number just in case 128 works with Number? No, keep String if PHP says so.
            // Actually, let's try Number again? The Hex error "body value missing" appeared with Number too.
            // Let's stick to STRING Partner ID as it's more robust per docs.
            partner_id: String(PARTNER_ID),
            apitxnid: orderId,
            amount: 100,
            webhook: WEBHOOK
        };

        const jsonPayload = JSON.stringify(innerPayload);
        console.log("Inner Payload:", jsonPayload);

        // Encrypt
        const encryptedHex = encryptAES(jsonPayload);
        console.log("Encrypted Hex (First 32):", encryptedHex.substring(0, 32) + "...");

        // Request Body
        const requestBody = {
            body: encryptedHex
        };
        console.log("Final Request Body:", JSON.stringify(requestBody));

        // URL
        const url = `${BASE_URL.replace(/\/$/, "")}/next/upi/request/qr`;
        console.log("Target URL:", url);

        // Headers
        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "api-key": API_KEY // Ensure exact match
        };
        console.log("Headers:", JSON.stringify(headers));

        console.log("\n--- SENDING REQUEST ---");
        const agent = new https.Agent({ family: 4 }); // Force IPv4

        const start = Date.now();
        const response = await axios.post(url, requestBody, {
            headers,
            httpsAgent: agent,
            timeout: 10000
        });
        const duration = Date.now() - start;

        console.log(`\n✅ RESPONSE RECEIVED (${duration}ms)`);
        console.log("Status:", response.status);
        console.log("Data:", JSON.stringify(response.data, null, 2));

        if (response.data.statuscode === 'TXN') {
            console.log("\n🚀 SUCCESS: QR Code Generated!");
        } else {
            console.error("\n⚠️ API RETURNED ERROR STATUS:", response.data.message);
        }

    } catch (error) {
        console.error("\n❌ REQUEST FAILED");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("Error:", error.message);
        }
    }
}

runTest();
