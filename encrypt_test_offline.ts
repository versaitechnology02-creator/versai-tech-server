
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

// Load env from .env at root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const AES_KEY_RAW = process.env.UNPAY_AES_KEY;

if (!AES_KEY_RAW) {
    console.error("Missing UNPAY_AES_KEY in .env");
    process.exit(1);
}

// 1. Strict AES Key Buffer (Forced AES-128)
function getAesKeyBuffer(): Buffer {
    // FORCE TRUNCATION TO 16 CHARS (AES-128)
    const keyPart = AES_KEY_RAW!.substring(0, 16);
    // Use UTF-8 parsing for the key
    return Buffer.from(keyPart, "utf8");
}

// 2. Encrypt Function
function encryptAES(data: string): string {
    const key = getAesKeyBuffer();
    const algo = "aes-128-ecb";

    console.log(`[Test] Key (Raw from Env): ${AES_KEY_RAW}`);
    console.log(`[Test] Key Used (16 chars): ${key.toString('utf8')}`);
    console.log(`[Test] Key Buffer (Hex): ${key.toString('hex')}`);
    console.log(`[Test] Key Length: ${key.length} bytes`);
    console.log(`[Test] Algo: ${algo}`);

    const cipher = crypto.createCipheriv(algo, key, null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(data, "utf8", "base64");
    encrypted += cipher.final("base64");
    return encrypted;
}

const payload = {
    partner_id: 4358,
    apitxnid: "TEST_" + Date.now(),
    amount: 100,
    webhook: "https://api.versaitechnology.com/api/unpay/callback"
};

const payloadString = JSON.stringify(payload);
console.log(`[Test] Payload: ${payloadString}`);

try {
    const encrypted = encryptAES(payloadString);
    console.log(`[Test] Encryption Success.`);
    console.log(`[Test] Encrypted Length: ${encrypted.length}`);
    console.log(`[Test] Encrypted String (Base64): ${encrypted}`);
} catch (e: any) {
    console.error("[Test] Encryption Failed:", e.message);
}
