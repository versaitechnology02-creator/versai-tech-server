import axios from "axios"
const EventSource = require("eventsource")

const ORDER_ID = "test_sse_order_" + Date.now()
const SERVER_URL = "http://localhost:5000" // Adjust port if needed

async function runVerification() {
    console.log(`[Verify] Starting SSE verification for order: ${ORDER_ID}`)

    // 1. Connect to SSE Stream
    console.log(`[Verify] Connecting to stream: ${SERVER_URL}/api/payments/stream/${ORDER_ID}`)
    const es = new EventSource(`${SERVER_URL}/api/payments/stream/${ORDER_ID}`)

    es.onopen = () => {
        console.log("[Verify] SSE Connection Opened!")

        // 2. Trigger Mock Webhook after 2 seconds
        setTimeout(async () => {
            console.log("[Verify] Simulate SMEPay Webhook triggering...")
            try {
                await axios.post(`${SERVER_URL}/api/payments/webhook/smepay`, {
                    order_id: ORDER_ID,
                    status: "SUCCESS", // SMEPay format
                    transaction_id: "tx_mock_12345",
                    amount: "100.00"
                })
                console.log("[Verify] Mock Webhook Sent.")
            } catch (err: any) {
                console.error("[Verify] Webhook failed:", err.message)
            }
        }, 2000)
    }

    es.onmessage = (event: any) => {
        console.log("[Verify] Received Event via SSE:", event.data)
        const data = JSON.parse(event.data)

        if (data.status === "completed") {
            console.log("✅ SUCCESS: Received completion update via SSE!")
            es.close()
            process.exit(0)
        }
    }

    es.onerror = (err: any) => {
        console.error("[Verify] SSE Error:", err)
        // es.close()
    }
}

// Check if server is running first
axios.get(`${SERVER_URL}/api/health`).catch(() => {
    console.log("⚠️  Server does not seem to be running at localhost:5000.")
    console.log("Please start the server first: npm start")
    process.exit(1)
})

runVerification()
