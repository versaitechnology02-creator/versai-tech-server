import axios from 'axios'
import crypto from 'crypto'
import dotenv from 'dotenv'

dotenv.config()

const AES_KEY = process.env.UNPAY_AES_KEY || 'Rg5QoemC6Y8AWcISg5NIDMIoBnA9ccHM'
const URL = 'http://localhost:5000/api/unpay/callback';

function encryptAESECB(text: string, key: string): string {
    const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(key), null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

async function testUnpay() {
    const innerPayload = JSON.stringify({
        apitxnid: "order_test_unpay_123", // Our internal order ID
        txnid: "unpay_ref_987654",       // UnPay ref ID
        amount: "100.00",
        statuscode: "TXN", // Success
        message: "Transaction Successful"
    });

    const encryptedBody = encryptAESECB(innerPayload, AES_KEY);

    const payload = {
        body: encryptedBody
    };

    try {
        console.log(`Sending UnPay Webhook to ${URL}...`);
        console.log('Original Payload:', innerPayload);
        console.log('Encrypted Body:', encryptedBody);

        const res = await axios.post(URL, payload);
        console.log('✅ UnPay Webhook Response:', res.status, res.data);
    } catch (err: any) {
        console.error('❌ UnPay Webhook Failed:', err.message);
        if (err.response) {
            console.error('Data:', err.response.data);
        }
    }
}

testUnpay();
