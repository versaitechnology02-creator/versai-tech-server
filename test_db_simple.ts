
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;

async function testConn() {
    console.log("Starting test...");
    try {
        await mongoose.connect(MONGO_URI!);
        console.log("Connected to DB");
        const collections = await mongoose.connection.db!.listCollections().toArray();
        console.log("Collections:", collections.map(c => c.name));

        const ApiKey = mongoose.connection.db!.collection('apikeys');
        const count = await ApiKey.countDocuments();
        console.log("ApiKey count:", count);

        const key = await ApiKey.findOne({ key: "op_live_g2ulvvhk7t919wi5p60qn8" });
        console.log("Key find result:", key ? "FOUND" : "NOT FOUND");

        if (!key) {
            const any = await ApiKey.findOne({});
            console.log("Sample key from DB:", any ? any.key : "NONE");
        }

        await mongoose.disconnect();
    } catch (err: any) {
        console.error("Connection failed:", err.message);
    }
}

testConn();
