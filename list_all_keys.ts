
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
const MONGO_URI = process.env.MONGODB_URI;
async function findKeys() {
    try {
        await mongoose.connect(MONGO_URI!);
        const ApiKey = mongoose.connection.db!.collection('apikeys');
        const keys = await ApiKey.find({}).toArray();
        console.log("KEYS FOUND IN DB:");
        keys.forEach(k => console.log(`- ${k.key} (Active: ${k.isActive})`));
        await mongoose.disconnect();
    } catch (e: any) {
        console.error(e.message);
    }
}
findKeys();
