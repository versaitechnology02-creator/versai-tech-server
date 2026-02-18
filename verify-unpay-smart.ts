
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from "path";
import mongoose from "mongoose";
import Transaction from "./src/models/Transaction";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const AES_KEY = process.env.UNPAY_AES_KEY || 'Rg5QoemC6Y8AWcISg5NIDMIoBnA9ccHM';
const URL = 'http://localhost:5000/api/unpay/callback';
const MONGODB_URI = process.env.MONGODB_URI;

function encryptAESECB(text: string, key: string): string {
    const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(key), null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

async function testUnpay() {
    try {
        await mongoose.connect(MONGODB_URI as string);
        console.log("✅ Connected to DB to find valid UnPay Order ID...");

        const txn = await Transaction.findOne({
            orderId: { $regex: /^order_/ },
            status: { $ne: "completed" },
            // Ideally filter for UnPay transactions if possible, but matching orderId prefix is usually enough
            // and checking description or notes if needed.
        }).sort({ createdAt: -1 });

        if (!txn) {
            console.error("❌ No valid pending transaction found in DB to test with.");
            process.exit(1);
        }

        const TEST_ORDER_ID = txn.orderId;
        console.log(`🎯 Using Order ID (apitxnid) from DB: ${TEST_ORDER_ID} (Current Status: ${txn.status})`);

        await mongoose.disconnect();

        // Prepare Payload
        const innerPayload = JSON.stringify({
            apitxnid: TEST_ORDER_ID, // Use the REAL order ID from DB
            txnid: "unpay_ref_" + Math.floor(Math.random() * 100000),
            amount: txn.amount.toFixed(2), // Ensure string format "100.00"
            statuscode: "TXN", // Success code
            message: "Transaction Successful"
        });

        // Encrypt
        const encryptedBody = encryptAESECB(innerPayload, AES_KEY);

        // The API likely expects { body: "encrypted_string" } or just raw string depending on implementation.
        // Based on previous logs, it seems to expect JSON { body: ... }
        const payload = {
            body: encryptedBody
        };

        console.log(`🚀 Sending UnPay Webhook to ${URL}...`);
        console.log('Original Payload:', innerPayload);

        const res = await axios.post(URL, payload);
        console.log('✅ UnPay Webhook Response:', res.status, res.data);
        console.log("👉 Now check Dashboard. Status should be 'Completed'.");

    } catch (err: any) {
        console.error('❌ UnPay Webhook Failed:', err.message);
        if (err.response) {
            console.error('Response Status:', err.response.status);
            console.error('Response Data:', err.response.data);
        }
    }
}

testUnpay();
