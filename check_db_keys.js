
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '.env') });

async function check() {
    try {
        console.log('Connecting...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        console.log('Collections:', collections.map(c => c.name));

        const ApiKey = db.collection('apikeys');
        const count = await ApiKey.countDocuments();
        console.log('Total keys:', count);

        const key = await ApiKey.findOne({});
        if (key) {
            console.log('Sample Key Prefix:', String(key.key).slice(0, 10));
            console.log('Sample Key Length:', String(key.key).length);
            console.log('Sample Key Value (full):', key.key);
        } else {
            console.log('No keys found in apikeys collection.');
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}
check();
