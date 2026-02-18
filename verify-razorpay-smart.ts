
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";
import Transaction from "./src/models/Transaction";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
const URL = "http://localhost:5000/api/payments/webhook/razorpay";
const MONGODB_URI = process.env.MONGODB_URI;

if (!WEBHOOK_SECRET) {
    console.error("❌ RAZORPAY_WEBHOOK_SECRET is not defined in .env");
    process.exit(1);
}

async function testRazorpay() {
    try {
        // 1. Find a pending transaction to use
        await mongoose.connect(MONGODB_URI as string);
        console.log("✅ Connected to DB to find valid Order ID...");

        const txn = await Transaction.findOne({
            orderId: { $regex: /^order_/ }, // Ensure it's a Razorpay order
            status: { $ne: "completed" }    // Prefer non-completed
        }).sort({ createdAt: -1 });

        if (!txn) {
            console.error("❌ No valid Razorpay transaction found in DB to test with.");
            process.exit(1);
        }

        const TEST_ORDER_ID = txn.orderId;
        console.log(`🎯 Using Order ID from DB: ${TEST_ORDER_ID} (Current Status: ${txn.status})`);

        await mongoose.disconnect();

        // 2. Prepare Payload
        const payload = JSON.stringify({
            "entity": "event",
            "account_id": "acc_test",
            "event": "payment.captured",
            "contains": ["payment"],
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_" + Math.random().toString(36).substring(7),
                        "entity": "payment",
                        "amount": txn.amount * 100,
                        "currency": "INR",
                        "status": "captured",
                        "order_id": TEST_ORDER_ID,
                        "method": "upi",
                        "description": "Smart Verification Test"
                    }
                }
            },
            "created_at": Math.floor(Date.now() / 1000)
        });

        // 3. Generate Signature
        const signature = crypto.createHmac('sha256', WEBHOOK_SECRET as string)
            .update(payload)
            .digest('hex');

        console.log(`🚀 Sending Webhook to ${URL}...`);

        // 4. Send Request
        const res = await axios.post(URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': signature
            }
        });

        console.log('✅ Razorpay Webhook Response:', res.status, res.data);
        console.log("👉 Now check Dashboard. Status should be 'Completed'.");

    } catch (err: any) {
        console.error('❌ Razorpay Webhook Failed:', err.message);
        if (err.response) {
            console.error('Response Status:', err.response.status);
            console.error('Response Data:', err.response.data);
        }
    }
}

testRazorpay();
