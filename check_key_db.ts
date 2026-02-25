
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load env
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/versai_pay";

async function checkKey() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("Connected to MongoDB");

        const targetKey = "op_live_g2ulvvhk7t919wi5p60qn8";

        // Define minimal schema for check
        const ApiKeySchema = new mongoose.Schema({
            key: String,
            userId: mongoose.Schema.Types.ObjectId,
            isActive: Boolean
        });
        const ApiKey = mongoose.models.ApiKey || mongoose.model('ApiKey', ApiKeySchema);

        const record = await ApiKey.findOne({ key: targetKey });

        if (record) {
            console.log("MATCH FOUND:");
            console.log(JSON.stringify(record, null, 2));
        } else {
            console.log("❌ KEY NOT FOUND IN DATABASE:", targetKey);

            // Just for debugging, show one key if exists
            const anyKey = await ApiKey.findOne({});
            if (anyKey) {
                console.log("Example key in DB for reference format:", anyKey.key);
            } else {
                console.log("Database has NO keys at all.");
            }
        }

        await mongoose.disconnect();
    } catch (err) {
        console.error("Error:", err);
    }
}

checkKey();
