
import { encryptAES, decryptAES } from "./services/unpay";

// Mock environment
process.env.UNPAY_AES_KEY = process.env.UNPAY_AES_KEY || "12345678901234567890123456789012"; // 32 chars
if (process.env.UNPAY_AES_KEY.length !== 32) {
    // PAD if needed for local test, though real key should be 32
    console.warn("Padding mock key to 32 chars for test");
    process.env.UNPAY_AES_KEY = "12345678901234567890123456789012";
}

async function verify() {
    console.log("--- UNPAY AES-128-ECB VERIFICATION ---");

    // 1. Verify Key Truncation
    const key = process.env.UNPAY_AES_KEY!;
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

    } catch (err: any) {
        console.error("Verification Failed:", err.message);
        process.exit(1);
    }
}

verify();
