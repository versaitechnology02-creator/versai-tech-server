
const crypto = require("crypto");

// Mock Config
const UNPAY_AES_KEY = "12345678901234567890123456789012"; // 32 chars
const IV_derived = UNPAY_AES_KEY.substring(0, 16);

console.log("--- ENCRYPTION VERIFICATION (Standalone) ---");
console.log(`Key Length: ${UNPAY_AES_KEY.length}`);
console.log(`IV (Derived): ${IV_derived}`);

function encryptAES(data) {
    const cipher = crypto.createCipheriv(
        "aes-256-cbc",
        Buffer.from(UNPAY_AES_KEY, "utf8"),
        Buffer.from(IV_derived, "utf8")
    )

    let encrypted = cipher.update(data, "utf8", "hex")
    encrypted += cipher.final("hex")

    return encrypted
}

function decryptAES(enc) {
    const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        Buffer.from(UNPAY_AES_KEY, "utf8"),
        Buffer.from(IV_derived, "utf8")
    )

    let decrypted = decipher.update(enc, "hex", "utf8")
    decrypted += decipher.final("utf8")

    return decrypted
}

// Run Test
const payload = JSON.stringify({
    partner_id: 4358,
    apitxnid: "test_order_123",
    amount: 100,
    webhook: "https://example.com"
});

try {
    const encrypted = encryptAES(payload);
    console.log("\nEncrypted Output:", encrypted);

    const isHex = /^[0-9a-f]+$/i.test(encrypted);
    console.log(`\nIs Hex? ${isHex ? "YES ✅" : "NO ❌"}`);

    if (isHex) {
        console.log("SUCCESS: Encryption format is correct.");
    } else {
        console.error("FAILURE: Encryption format is INCORRECT.");
    }

    const decrypted = decryptAES(encrypted);
    console.log("\nDecrypted Output:", decrypted);
    console.log(`Match? ${decrypted === payload ? "YES ✅" : "NO ❌"}`);

} catch (err) {
    console.error("Error:", err.message);
}
