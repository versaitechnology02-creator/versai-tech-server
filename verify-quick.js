const crypto = require("crypto");

// Mock Env
process.env.UNPAY_AES_KEY = "12345678901234567890123456789012";

function getAesKeyBuffer() {
    const keyRaw = process.env.UNPAY_AES_KEY || "";
    if (keyRaw.length !== 32) throw new Error("Invalid Key Length");
    return Buffer.from(keyRaw, "utf8");
}

function encryptAES(data) {
    const key = getAesKeyBuffer();
    const algo = "aes-256-ecb";
    const cipher = crypto.createCipheriv(algo, key, null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted.toUpperCase();
}

function decryptAES(enc) {
    const key = getAesKeyBuffer();
    const algo = "aes-256-ecb";
    const decipher = crypto.createDecipheriv(algo, key, null);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(enc, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

console.log("--- QUICK VERIFY ---");
const payload = JSON.stringify({
    partner_id: 4358,
    apitxnid: "test_order_123",
    amount: 100,
    webhook: "https://example.com"
});
console.log("Payload:", payload);

const enc = encryptAES(payload);
console.log("Encrypted (Hex):", enc);
const dec = decryptAES(enc);
console.log("Decrypted:", dec);
console.log("Match:", dec === payload);
