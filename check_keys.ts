
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;

async function checkDatabase() {
    if (!MONGO_URI) {
        console.error("MONGODB_URI not found in .env");
        return;
    }

    try {
        console.log("Connecting to:", MONGO_URI.split('@')[1] || "local");
        await mongoose.connect(MONGO_URI);
        console.log("Connected successfully");

        const targetKey = "op_live_g2ulvvhk7t919wi5p60qn8";

        const ApiKeySchema = new mongoose.Schema({ key: String }, { strict: false });
        const ApiKey = mongoose.models.ApiKey || mongoose.model('ApiKey', ApiKeySchema);

        console.log("Searching for:", targetKey);
        const record = await ApiKey.findOne({ key: targetKey });

        if (record) {
            console.log("✅ MATCH FOUND!");
            console.log(record);
        } else {
            console.log("❌ KEY NOT FOUND");
            const count = await ApiKey.countDocuments();
            console.log("Total keys in DB:", count);

            const keys = await ApiKey.find().limit(5);
            console.log("First 5 keys in DB (censored):");
            keys.forEach(k => {
                const s = String(k.key);
                console.log(`- ${s.slice(0, 10)}... (length: ${s.length})`);
            });
        }

        await mongoose.disconnect();
    } catch (err) {
        console.error("Error:", err);
    }
}

checkDatabase();
