
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import Transaction from "../src/models/Transaction";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI is not defined in .env");
    process.exit(1);
}

async function dumpRecentTransactions() {
    try {
        await mongoose.connect(MONGODB_URI as string);
        console.log("✅ Connected to MongoDB");

        const txns = await Transaction.find().sort({ createdAt: -1 }).limit(5).lean();

        console.log("🔍 DUMPING LAST 5 TRANSACTIONS (RAW JSON):");
        console.log(JSON.stringify(txns, null, 2));

        process.exit(0);
    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
}

dumpRecentTransactions();
