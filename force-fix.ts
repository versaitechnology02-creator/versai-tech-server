
import mongoose from "mongoose";
import Transaction from "./src/models/Transaction";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const MONGODB_URI = process.env.MONGODB_URI;
const TARGET_ORDER_ID = "order_SHWgaKfcM6VZ1v"; // as requested by user

async function forceComplete() {
    try {
        // 1. Connect
        console.log("🔌 Connecting to DB...");
        await mongoose.connect(MONGODB_URI as string);
        console.log("✅ DB Connected.");

        // 2. Find
        console.log(`🔍 Finding Order: ${TARGET_ORDER_ID}...`);
        const txn = await Transaction.findOne({ orderId: TARGET_ORDER_ID });

        if (!txn) {
            console.error("❌ Order not found!");
            process.exit(1);
        }

        console.log(`📄 Found Order. Current Status: ${txn.status}`);

        if (txn.status === 'completed') {
            console.log("✅ Order is already completed.");
            process.exit(0);
        }

        // 3. Update
        txn.status = "completed";
        // Generate a fallback payment ID if missing
        txn.paymentId = txn.paymentId || "manual_fix_" + Date.now();
        txn.updatedAt = new Date();

        // Explicitly mark modified
        txn.markModified("status");
        txn.markModified("paymentId");
        txn.markModified("updatedAt");

        await txn.save();
        console.log("✅ Order updated to 'completed' in DB.");
        console.log("ℹ️ Please refresh your dashboard now.");

        await mongoose.disconnect();

    } catch (err: any) {
        console.error("❌ Error:", err.message);
    }
}

forceComplete();
