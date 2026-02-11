
import { encryptAES, decryptAES } from "./services/unpay";

// Mock Config if not loaded
if (!process.env.UNPAY_AES_KEY) {
    console.log("Mocking UNPAY_AES_KEY for verification...");
    process.env.UNPAY_AES_KEY = "12345678901234567890123456789012"; // 32 chars
}

if (!process.env.UNPAY_IV) {
    // Legacy support, though code uses key substring
    process.env.UNPAY_IV = "1234567890123456";
}

async function verify() {
    console.log("--- ENCRYPTION VERIFICATION ---");
    const key = process.env.UNPAY_AES_KEY || "";
    console.log(`Key Length: ${key.length} (Should be 32)`);

    // Test Payload
    const payload = JSON.stringify({
        partner_id: 4358,
        apitxnid: "test_order_123",
        amount: 100,
        webhook: "https://example.com"
    });
    console.log("Plain Payload:", payload);

    try {
        // Encrypt
        const encrypted = encryptAES(payload);
        console.log("\nEncrypted Output:", encrypted);

        // Check format
        const isHex = /^[0-9a-f]+$/i.test(encrypted);
        const isBase64 = /^[a-zA-Z0-9+/]+={0,2}$/.test(encrypted) && !isHex; // Rough check

        console.log(`\nIs Hex? ${isHex ? "YES ✅" : "NO ❌"}`);
        console.log(`Is Base64? ${isBase64 ? "YES ❌" : "NO ✅"}`);

        if (!isHex) {
            console.error("CRITICAL: Output is NOT Hex string!");
        }

        // Decrypt
        const decrypted = decryptAES(encrypted);
        console.log("\nDecrypted Output:", decrypted);
        console.log(`Match? ${decrypted === payload ? "YES ✅" : "NO ❌"}`);

    } catch (err: any) {
        console.error("Encryption Failed:", err.message);
    }
}

verify();
