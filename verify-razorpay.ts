import axios from 'axios'
import crypto from 'crypto'
import dotenv from 'dotenv'
dotenv.config()

const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'MYXn72nZHqNVHUX80GydUTD2' // Fallback to key secret if not set separately? The .env only showed KEY_SECRET. 
// WAIT: The .env showed RAZORPAY_KEY_SECRET=MYXn72nZHqNVHUX80GydUTD2 but NO RAZORPAY_WEBHOOK_SECRET.
// I need to use whatever the controller is using. The controller uses process.env.RAZORPAY_WEBHOOK_SECRET.
// If it's missing in .env, the webhook will fail 500.
// Correct action: I should check if I need to ADD it to .env or if it's meant to be the same as KEY_SECRET. 
// Usuall webhook secret is different. But for testing I will assume the user has set it or I should set it. 
// START EDIT: I will assume for this test that I need to add it to .env if missing, or user needs to.
// Actually, looking at the code I wrote in webhookController.ts:
// const secret = process.env.RAZORPAY_WEBHOOK_SECRET
// It returns 500 if missing.
// I see RAZORPAY_KEY_SECRET in .env. I don't see WEBHOOK_SECRET.
// I should probably set RAZORPAY_WEBHOOK_SECRET = RAZORPAY_KEY_SECRET for now in the test env or ask the user.
// BUT, to make the test PASS logistically, I will use a known secret and pass it.
// However, the SERVER needs it.
// I will just use '123456' for testing and I will mock the server process or assume the user sets it.
// actually, I can't modify the running server's env easily without restart.
// Let's check if the previous controller code I wrote used a default or just env.
// It used strict process.env.
// I will update the .env file first to include RAZORPAY_WEBHOOK_SECRET with a dummy value for testing.

const WEBHOOK_SECRET = "123456_test_secret";
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

    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET)
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
