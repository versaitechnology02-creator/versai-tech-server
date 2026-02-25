
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

async function run() {
    console.log("Connecting...");
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log("Connected!");
        const db = client.db('versai_db');
        const collection = db.collection('apikeys');
        const keys = await collection.find({}).toArray();
        console.log("KEYS FOUND:");
        keys.forEach(k => console.log("- " + k.key));
    } catch (e) {
        console.error("ERROR:", e.message);
    } finally {
        await client.close();
        console.log("Closed.");
    }
}

run();
