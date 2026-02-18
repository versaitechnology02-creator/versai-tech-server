
import mongoose from "mongoose";
import Transaction from "../src/models/Transaction";
import dotenv from "dotenv";
import path from "path";
import { sseManager } from "../src/utils/sse";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI;
const TARGET_ORDER_ID = "order_SHWgaKfcM6VZ1v"; // as requested by user

async function forceComplete() {
    try {
        await mongoose.connect(MONGODB_URI as string);
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

        // Update to completed
        txn.status = "completed";
        txn.paymentId = "manual_fix_" + Date.now();
        txn.updatedAt = new Date();
        txn.markModified("status");
        txn.markModified("paymentId");
        txn.markModified("updatedAt");

        await txn.save();
        console.log("✅ Order updated to 'completed' in DB.");

        try {
            // Since we are running as a standalone script, we can't emit SSE to the running server process directly.
            // But the DB update is the most important part.
            // To really notify SSE clients, we'd need Redis or similar.
            // For now, refreshing the dashboard is enough.
            console.log("ℹ️ Dashboard refresh required to see changes.");
        } catch (e) { }

        await mongoose.disconnect();

    } catch (err) {
        console.error("❌ Error:", err);
    }
}

forceComplete();
