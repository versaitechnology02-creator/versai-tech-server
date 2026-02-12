
const crypto = require("crypto");

// Mock Config
const UNPAY_AES_KEY = "12345678901234567890123456789012"; // 32 chars

function getAesKeyBuffer() {
    if (!UNPAY_AES_KEY) {
        throw new Error("UNPAY_AES_KEY is missing")
    }
    // Use first 16 bytes for AES-128
    return Buffer.from(UNPAY_AES_KEY, "utf8").subarray(0, 16)
}

function encryptAES(data) {
    const key = getAesKeyBuffer()

    // AES-128-ECB does not use IV
    const cipher = crypto.createCipheriv("aes-128-ecb", key, null)

    let encrypted = cipher.update(data, "utf8", "hex")
    encrypted += cipher.final("hex")

    return encrypted.toUpperCase() // Must be UPPERCASE
}

function decryptAES(enc) {
    const key = getAesKeyBuffer()

    const decipher = crypto.createDecipheriv("aes-128-ecb", key, null)

    let decrypted = decipher.update(enc, "hex", "utf8")
    decrypted += decipher.final("utf8")

    return decrypted
}

async function verify() {
    console.log("--- UNPAY AES-128-ECB VERIFICATION (PURE JS) ---");

    // 1. Verify Key Truncation
    const key = UNPAY_AES_KEY;
    console.log(`Original Key Length: ${key.length}`);
    console.log(`Used Key (First 16 chars): ${key.substring(0, 16)}`);

    // 2. Test Payload
    const payload = JSON.stringify({
        partner_id: 12345,
        apitxnid: "ORDER_001",
        amount: 100,
        webhook: "https://callback.url"
    });
    console.log("\nPayload:", payload);

    try {
        // 3. Encrypt
        const encrypted = encryptAES(payload);
        console.log("\nEncrypted Output:", encrypted);

        // 4. Verify Hex and Uppercase
        const isHex = /^[0-9A-F]+$/.test(encrypted);
        console.log(`Is Uppercase Hex? ${isHex ? "YES ✅" : "NO ❌"}`);

        if (!isHex) {
            throw new Error("Encryption is not Uppercase Hex");
        }

        // 5. Decrypt
        const decrypted = decryptAES(encrypted);
        console.log("\nDecrypted Output:", decrypted);

        console.log(`Match? ${decrypted === payload ? "YES ✅" : "NO ❌"}`);

    } catch (err) {
        console.error("Verification Failed:", err.message);
        process.exit(1);
    }
}

verify();
