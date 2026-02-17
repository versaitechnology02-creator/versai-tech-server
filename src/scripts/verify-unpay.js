
const axios = require('axios');
const crypto = require('crypto');

// CONFIG
const BASE_URL = 'http://localhost:5000/api';
const UNPAY_AES_KEY = process.env.UNPAY_AES_KEY || 'YOUR_AES_KEY_HERE'; // Replace if needed for local test

// HELPER: Encrypt Mock Body
function encryptAESECB(text, key) {
    const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(key), null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

async function testWebhook() {
    console.log('\n--- TESTING UNPAY WEBHOOK ---');

    // 1. Plaintext Webhook
    try {
        console.log('1. Sending Plaintext Webhook...');
        const res = await axios.post(`${BASE_URL}/unpay/callback`, {
            apitxnid: 'ORDER_12345',
            statuscode: 'TXN',
            txnid: 'PAY_98765',
            message: 'Success'
        });
        console.log('   Response:', res.data);
    } catch (err) {
        console.error('   Error:', err.response ? err.response.data : err.message);
    }

    // 2. Encrypted Webhook
    if (UNPAY_AES_KEY !== 'YOUR_AES_KEY_HERE') {
        try {
            console.log('\n2. Sending Encrypted Webhook...');
            const payload = JSON.stringify({
                apitxnid: 'ORDER_ENCRYPTED_123',
                statuscode: 'TXN',
                txnid: 'PAY_ENC_999',
                message: 'Encrypted Success'
            });

            const encryptedBody = encryptAESECB(payload, UNPAY_AES_KEY);

            const res = await axios.post(`${BASE_URL}/unpay/callback`, {
                body: encryptedBody
            });
            console.log('   Response:', res.data);
        } catch (err) {
            console.error('   Error:', err.response ? err.response.data : err.message);
        }
    } else {
        console.log('\n2. Skipping Encrypted Test (No AES Key set in script)');
    }
}

async function testDashboard() {
    console.log('\n--- TESTING DASHBOARD API ---');
    // Note: This requires a valid user token. 
    // For manual local testing, you'd need to login first.
    console.log('Skipping automated dashboard test (needs auth token).');
    console.log('Please verify manually by logging into the frontend.');
}

(async () => {
    await testWebhook();
    await testDashboard();
})();
