
import { encryptAES, decryptAES } from "./services/unpay";

// Mock Config if not loaded
// MUST be exactly 32 bytes for verification if not in env
if (!process.env.UNPAY_AES_KEY || process.env.UNPAY_AES_KEY.length !== 32) {
    console.log("Mocking UNPAY_AES_KEY (32 bytes) for verification...");
    process.env.UNPAY_AES_KEY = "12345678901234567890123456789012"; // 32 chars
}

async function verify() {
    console.log("--- ENCRYPTION VERIFICATION (STRICT) ---");
    const key = process.env.UNPAY_AES_KEY || "";
    console.log(`Key Length: ${key.length} (Requirement: 32)`);

    // Test Payload
    const payloadObject = {
        partner_id: 4358, // Number
        apitxnid: "test_order_123",
        amount: 100,      // Number
        webhook: "https://example.com"
    };
    const payload = JSON.stringify(payloadObject);
    console.log("\nPlain Payload:", payload);

    try {
        // Encrypt
        const encrypted = encryptAES(payload);
        console.log("\nEncrypted Output:", encrypted);

        // Check format
        const isHex = /^[0-9A-F]+$/.test(encrypted); // Uppercase Hex
        console.log(`\nIs Uppercase Hex? ${isHex ? "YES ✅" : "NO ❌"}`);

        if (!isHex) {
            console.error("CRITICAL: Output is NOT valid Hex string!");
        }

        // Decrypt
        const decrypted = decryptAES(encrypted);
        console.log("\nDecrypted Output:", decrypted);
        console.log(`Match? ${decrypted === payload ? "YES ✅" : "NO ❌"}`);

        // Final Wrapper Check
        const finalBody = { body: encrypted };
        console.log("\nFinal Request Body Structure:", JSON.stringify(finalBody));

    } catch (err: any) {
        console.error("Encryption Logic Failed:", err.message);
    }
}

verify();
