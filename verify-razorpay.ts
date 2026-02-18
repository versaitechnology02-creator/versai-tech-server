import axios from 'axios'
import crypto from 'crypto'
import dotenv from 'dotenv'
dotenv.config()

// MATCH SERVER LOGIC EXACTLY
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

if (!WEBHOOK_SECRET) {
    console.error("❌ Error: No RAZORPAY_WEBHOOK_SECRET or RAZORPAY_KEY_SECRET found in .env");
    process.exit(1);
}

console.log(`Using Secret for Signature: ${WEBHOOK_SECRET.substring(0, 5)}...`);

const URL = 'http://localhost:5000/api/payments/webhook/razorpay';

async function testRazorpay() {
    const payload = JSON.stringify({
        "entity": "event",
        "account_id": "acc_BFw7sDq0112345",
        "event": "payment.captured",
        "contains": [
            "payment"
        ],
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_Des7gnF6212345",
                    "entity": "payment",
                    "amount": 50000,
                    "currency": "INR",
                    "status": "captured",
                    "order_id": "order_test_123456", // Matches an order we should ideally create or mock
                    "email": "test@example.com",
                    "contact": "+919999999999"
                }
            }
        },
        "created_at": 1582628071
    });

    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET as string)
        .update(payload)
        .digest('hex');

    try {
        console.log(`Sending Razorpay Webhook to ${URL}...`);
        const res = await axios.post(URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-razorpay-signature': signature
            }
        });

        console.log('✅ Razorpay Webhook Response:', res.status, res.data);
    } catch (err: any) {
        console.error('❌ Razorpay Webhook Failed:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        }
    }
}

testRazorpay();
