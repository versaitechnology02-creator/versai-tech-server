import dotenv from 'dotenv';
import path from 'path';

// Load env from .env at root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { createUnpayDynamicQR } from './src/services/unpay';

async function run() {
    console.log("--- REPRO START ---");
    try {
        console.log("PartnerID Env:", process.env.UNPAY_PARTNER_ID);
        // Don't log full key/secret
        console.log("APIKey Env Length:", process.env.UNPAY_API_KEY ? process.env.UNPAY_API_KEY.length : "MISSING");
        console.log("AESKey Env Length:", process.env.UNPAY_AES_KEY ? process.env.UNPAY_AES_KEY.length : "MISSING");

        const result = await createUnpayDynamicQR({
            amount: 100,
            apitxnid: "REPRO_TXN_" + Date.now(),
            webhook: "https://api.versaitechnology.com/api/unpay/callback"
        });
        console.log("Success:", result);
    } catch (e: any) {
        console.error("Repro Failed:", e.message);
        if (e.response) {
            console.error("HTTP Status:", e.response?.status);
            console.error("HTTP Data:", e.response?.data);
        }
    }
    console.log("--- REPRO END ---");
}

run();
