
import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';

// Load env from .env at root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PARTNER_ID = process.env.UNPAY_PARTNER_ID;
const API_KEY = process.env.UNPAY_API_KEY;
const AES_KEY_RAW = process.env.UNPAY_AES_KEY;
const BASE_URL = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "");

if (!PARTNER_ID || !API_KEY || !AES_KEY_RAW) {
    console.error("Missing Env Vars");
    process.exit(1);
}

function encryptAES(data: string, keyRaw: string, algo: 'aes-128-ecb' | 'aes-256-ecb'): string {
    let key: Buffer;
    if (algo === 'aes-128-ecb') {
        // Use first 16 chars or full if 16
        key = Buffer.from(keyRaw.substring(0, 16), "utf8");
    } else {
        key = Buffer.from(keyRaw, "utf8");
    }

    const cipher = crypto.createCipheriv(algo, key, null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(data, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
}

async function testConfig(algo: 'aes-128-ecb' | 'aes-256-ecb', partnerIdAs: 'number' | 'string') {
    console.log(`\n\n[TEST] Algo: ${algo}, PartnerID Type: ${partnerIdAs}`);

    const txnId = "REPRO_" + Date.now();
    const payload = {
        partner_id: partnerIdAs === 'number' ? Number(PARTNER_ID) : String(PARTNER_ID),
        apitxnid: txnId,
        amount: 100,
        webhook: "https://api.versaitechnology.com/api/unpay/callback"
    };

    console.log("Payload:", JSON.stringify(payload));

    try {
        const encrypted = encryptAES(JSON.stringify(payload), AES_KEY_RAW!, algo);

        const url = `${BASE_URL}/next/upi/request/qr`;
        console.log("URL:", url);

        const resp = await axios.post(url, { encdata: encrypted }, {
            headers: {
                "Content-Type": "application/json",
                "api-key": API_KEY!.trim()
            },
            validateStatus: () => true // Don't throw
        });

        console.log("Status:", resp.status);
        console.log("Response:", JSON.stringify(resp.data));
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

async function run() {
    console.log("--- ADVANCED DEBUGGING START ---");
    console.log("AES KEY (first 5):", AES_KEY_RAW?.substring(0, 5));
    console.log("AES KEY Length:", AES_KEY_RAW?.length);

    // Test 1: Current Logic (AES-256, Number)
    await testConfig('aes-256-ecb', 'number');

    // Test 2: AES-128 (Truncated Key), Number
    await testConfig('aes-128-ecb', 'number');

    // Test 3: AES-256, String PartnerID
    await testConfig('aes-256-ecb', 'string');

    // Test 4: AES-128, String PartnerID
    await testConfig('aes-128-ecb', 'string');

    console.log("--- ADVANCED DEBUGGING END ---");
}

run();
