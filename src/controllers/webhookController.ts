import { Request, Response } from "express"
import crypto from "crypto"
import Transaction from "../models/Transaction"
import razorpay from "../config/razorpay"

export const razorpayWebhookHandler = async (req: Request, res: Response) => {
    try {
        const signature = req.headers["x-razorpay-signature"] as string
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET

        if (!secret) {
            console.error("[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not configured")
            return res.status(500).json({ status: "error", message: "Webhook secret missing" })
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

        // Parse specific events from the raw body if needed, or rely on req.body being passed as Buffer
        // Express.raw() makes req.body a Buffer. We need to parse strictly what we need.
        const event = JSON.parse(req.body.toString())

        console.log("🔥🔥 WEBHOOK RECEIVED 🔥🔥")
        console.log("[Razorpay Webhook] Event:", event.event)
        console.log("[Razorpay Webhook] Payload:", JSON.stringify(event.payload, null, 2))

        if (event.event === "payment.captured" || event.event === "order.paid") {
            const payment = event.payload.payment.entity
            const orderId = payment.order_id
            const paymentId = payment.id

            // Update transaction status
            // We look for orderId in our DB.
            // NOTE: Razorpay sends 'order_id', our DB has 'orderId'
            console.log(`[Razorpay Webhook] Updating order ${orderId} to success`)

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

            if (transaction) {
                console.log(`[Razorpay Webhook] Successfully updated transaction ${transaction._id}`)
            } else {
                console.warn(`[Razorpay Webhook] Transaction not found for orderId: ${orderId}`)
            }
        }

        res.status(200).json({ status: "ok" })
    } catch (error: any) {
        console.error("[Razorpay Webhook] Error processing webhook:", error)
        res.status(500).json({ status: "error", message: error.message })
    }
}
