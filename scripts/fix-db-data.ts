
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import User from "../src/models/User";
import Transaction from "../src/models/Transaction";

// Load env from root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI is not defined in .env");
    process.exit(1);
}

async function fixDatabase() {
    try {
        console.log("🔄 Connecting to MongoDB...");
        await mongoose.connect(MONGODB_URI as string);
        console.log("✅ Connected.");

        // 1. Fix Missing Dates (createdAt)
        const txnsWithoutDate = await Transaction.find({ createdAt: { $exists: false } });
        console.log(`Found ${txnsWithoutDate.length} transactions without 'createdAt'. Fixing...`);

        for (const txn of txnsWithoutDate) {
            // Backfill from ObjectId timestamp
            const timestamp = txn._id.getTimestamp();
            await Transaction.updateOne(
                { _id: txn._id },
                { $set: { createdAt: timestamp, updatedAt: timestamp } }
            );
            console.log(`✅ Fixed Date for Txn: ${txn._id}`);
        }

        // 2. Fix Missing Customer Info
        // Find txns where customer.name is missing BUT userId exists
        const txnsMissingCustomer = await Transaction.find({
            $or: [
                { "customer.name": { $exists: false } },
                { customer: { $exists: false } }
            ],
            userId: { $ne: null }
        }).populate("userId");

        console.log(`Found ${txnsMissingCustomer.length} transactions with missing customer info (but have userId). Fixing...`);

        for (const txn of txnsMissingCustomer) {
            const user = txn.userId as any; // Cast populated field
            if (user && user.name) {
                await Transaction.updateOne(
                    { _id: txn._id },
                    {
                        $set: {
                            customer: {
                                name: user.name || "N/A",
                                email: user.email || "N/A",
                                phone: user.phone || ""
                            }
                        }
                    }
                );
                console.log(`✅ Fixed Customer for Txn: ${txn._id} -> ${user.name}`);
            } else {
                console.warn(`⚠️ User not found or has no name for Txn: ${txn._id}`);
            }
        }

        console.log("🎉 Database Fix Complete!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error fixing database:", error);
        process.exit(1);
    }
}

fixDatabase();
