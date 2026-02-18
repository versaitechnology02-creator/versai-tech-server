
import { Request, Response } from "express"
import crypto from "crypto"
import Transaction from "../models/Transaction"
import razorpay from "../config/razorpay"

export const razorpayWebhookHandler = async (req: Request, res: Response) => {
    try {
        console.log("⚡ RAZORPAY WEBHOOK HIT: STARTING ⚡");
        console.log("Headers:", JSON.stringify(req.headers, null, 2));

        const signature = req.headers["x-razorpay-signature"] as string
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET

        if (!secret) {
            console.error("[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET (or KEY_SECRET fallback) is not configured")
            return res.status(500).json({ status: "error", message: "Webhook secret missing" })
        }

        if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
            console.warn("[Razorpay Webhook] Using RAZORPAY_KEY_SECRET as fallback. Please set RAZORPAY_WEBHOOK_SECRET.")
        }

        if (!signature) {
            console.error("[Razorpay Webhook] Missing signature header")
            return res.status(400).json({ status: "error", message: "Missing signature" })
        }

        // validate signature
        const shasum = crypto.createHmac("sha256", secret)
        shasum.update(req.body)
        const digest = shasum.digest("hex")

        if (digest !== signature) {
            console.error("[Razorpay Webhook] Invalid signature", {
                expected: digest,
                received: signature,
            })
            return res.status(400).json({ status: "error", message: "Invalid signature" })
        }

        const event = JSON.parse(req.body.toString())

        console.log("🔥🔥 WEBHOOK RECEIVED 🔥🔥")
        console.log("[Razorpay Webhook] Event:", event.event)

        // Deep Debug: Log Payload
        // console.log("[Razorpay Webhook] Payload:", JSON.stringify(event.payload, null, 2));

        if (event.event === "payment.captured" || event.event === "order.paid") {
            const payment = event.payload.payment.entity
            const orderId = payment.order_id
            const paymentId = payment.id

            console.log(`[Razorpay Webhook] Updating order ${orderId} to completed`)

            const transaction = await Transaction.findOneAndUpdate(
                { orderId: orderId },
                {
                    $set: {
                        status: "completed",
                        paymentId: paymentId,
                        updatedAt: new Date(),
                        "notes.razorpay_webhook_event": event,
                    },
                },
                { new: true }
            )

            console.log("🔍 [Razorpay Webhook] DB Update Result:", transaction ? "SUCCESS" : "FAILED - No Match Found");
            if (transaction) {
                console.log("✅ Updated Transaction:", JSON.stringify(transaction.toObject(), null, 2));
            } else {
                console.log("❌ CRITICAL: Could not find transaction with orderId:", orderId);
                console.log("🤔 Hint: Check if DB has 'orderId' or 'order_id' field.");
            }
        }

        res.status(200).json({ status: "ok" })
    } catch (error: any) {
        console.error("[Razorpay Webhook] Error processing webhook:", error)
        res.status(500).json({ status: "error", message: error.message })
    }
}
