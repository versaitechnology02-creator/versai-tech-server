
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import Transaction from "./src/models/Transaction";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const URL = "http://localhost:5000/api/payments/webhook/smepay"; // Direct hit to avoid redirect issues in test
// const URL_PROVIDER = "http://localhost:5000/api/smepay/callback"; // Real provider URL

const MONGODB_URI = process.env.MONGODB_URI;

async function testSmepay() {
    try {
        // 1. Find a pending transaction (SMEPay prefers orderId that looks like 'order_SHW...')
        await mongoose.connect(MONGODB_URI as string);
        console.log("✅ Connected to DB to find valid Order ID...");

        const txn = await Transaction.findOne({
            orderId: { $regex: /^order_/ },
            status: { $ne: "completed" }
        }).sort({ createdAt: -1 });

        if (!txn) {
            console.error("❌ No valid transaction found in DB to test with.");
            process.exit(1);
        }

        const TEST_REF_ID = txn.orderId;
        console.log(`🎯 Using Order ID (ref_id) from DB: ${TEST_REF_ID} (Current Status: ${txn.status})`);

        await mongoose.disconnect();

        // 2. Prepare Payload (Mimicking SMEPay callback)
        const payload = {
            order_id: "THF" + Math.random().toString(36).substring(7).toUpperCase(),
            ref_id: TEST_REF_ID,
            payment_status: "SUCCESS", // Or COMPLETED
            amount: txn.amount,
            transaction_type: "payin",
            message: "Transaction Successful"
        };

        console.log(`🚀 Sending SMEPay Webhook to ${URL}...`);
        console.log("Payload:", JSON.stringify(payload, null, 2));

        // 3. Send Request
        const res = await axios.post(URL, payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ SMEPay Webhook Response:', res.status, res.data);
        console.log("👉 Now check Dashboard. Status should be 'Completed'.");

    } catch (err: any) {
        console.error('❌ SMEPay Webhook Failed:', err.message);
        if (err.response) {
            console.error('Response Status:', err.response.status);
            console.error('Response Data:', err.response.data);
        }
    }
}

testSmepay();
