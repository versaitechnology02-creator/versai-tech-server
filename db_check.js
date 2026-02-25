
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function run() {
    const log = [];
    try {
        log.push('Connecting to ' + process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI);
        log.push('Connected.');

        const ApiKey = mongoose.connection.db.collection('apikeys');
        const keys = await ApiKey.find({}).toArray();
        log.push(`Found ${keys.length} keys.`);

        keys.forEach(k => {
            log.push(`Key ID: ${k._id}, Prefix: ${String(k.key).slice(0, 15)}, Len: ${String(k.key).length}, Active: ${k.isActive}`);
        });

        const targetKey = 'op_live_7v0c8vuef7lbrnrit8pjf6';
        const found = await ApiKey.findOne({ key: targetKey });
        log.push(`Searching for ${targetKey}: ${found ? 'FOUND' : 'NOT FOUND'}`);

    } catch (err) {
        log.push('Error: ' + err.message);
    } finally {
        fs.writeFileSync('db_check_result.txt', log.join('\n'));
        await mongoose.disconnect();
        process.exit(0);
    }
}
run();
