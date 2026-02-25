
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '.env') });

async function check() {
    try {
        console.log('Connecting...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        const ApiKey = mongoose.connection.db.collection('apikeys');
        const key = await ApiKey.findOne({});
        if (key) {
            console.log('FOUND_KEY:', key.key);
        } else {
            console.log('NO_KEYS_IN_DB');
        }

        // Use count as well
        const count = await ApiKey.countDocuments();
        console.log('TOTAL_KEYS_COUNT:', count);

    } catch (err) {
        console.error('FAIL:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}
check();
