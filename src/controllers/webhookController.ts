
import { Request, Response } from "express"
import crypto from "crypto"
import Transaction from "../models/Transaction"
import { sseManager } from "../utils/sse"

export const razorpayWebhookHandler = async (req: Request, res: Response) => {
    try {
        console.log("⚡ RAZORPAY WEBHOOK HIT ⚡")
        console.log("[Razorpay Webhook] Headers:", JSON.stringify(req.headers, null, 2))

        const signature = req.headers["x-razorpay-signature"] as string
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
        const keySecret = process.env.RAZORPAY_KEY_SECRET

        // ──────────────────────────────────────────
        // Secret Selection with diagnostics
        // ──────────────────────────────────────────
        if (!webhookSecret || webhookSecret === "CHANGE_ME_TO_REAL_SECRET" || webhookSecret === "123456_test_secret") {
            console.error("❌ [Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not set or is still a placeholder!")
            console.error("👉 Go to Razorpay Dashboard → Settings → Webhooks → Edit → copy the Secret → paste in .env")

            if (!keySecret) {
                return res.status(500).json({ status: "error", message: "RAZORPAY_WEBHOOK_SECRET not configured" })
            }

            // Fallback: try with KEY_SECRET — this will only work if you set the webhook secret to the same value
            console.warn("[Razorpay Webhook] Falling back to RAZORPAY_KEY_SECRET (this is WRONG — fix your .env!)")
        }

        const secret = (webhookSecret && webhookSecret !== "CHANGE_ME_TO_REAL_SECRET" && webhookSecret !== "123456_test_secret")
            ? webhookSecret
            : keySecret!

        if (!signature) {
            console.error("[Razorpay Webhook] ❌ Missing x-razorpay-signature header")
            return res.status(400).json({ status: "error", message: "Missing signature header" })
        }

        // ──────────────────────────────────────────
        // Signature Verification (HMAC-SHA256)
        // ──────────────────────────────────────────
        const shasum = crypto.createHmac("sha256", secret)
        shasum.update(req.body)
        const digest = shasum.digest("hex")

        if (digest !== signature) {
            console.error("❌ [Razorpay Webhook] Signature mismatch!")
            console.error(`   Expected (computed): ${digest}`)
            console.error(`   Received (header):   ${signature}`)
            console.error("👉 FIX: The RAZORPAY_WEBHOOK_SECRET in .env must match the secret you set in")
            console.error("        Razorpay Dashboard → Settings → Webhooks → your webhook entry → Secret field")
            return res.status(400).json({ status: "error", message: "Invalid signature — check RAZORPAY_WEBHOOK_SECRET in .env" })
        }

        // ──────────────────────────────────────────
        // Parse Event
        // ──────────────────────────────────────────
        const event = JSON.parse(req.body.toString())

        console.log("🔥 [Razorpay Webhook] Event received:", event.event)
        console.log("[Razorpay Webhook] Full payload:", JSON.stringify(event.payload, null, 2))

        // ──────────────────────────────────────────
        // Handle: payment.captured OR order.paid
        // ──────────────────────────────────────────
        if (event.event === "payment.captured" || event.event === "order.paid") {
            const payment = event.payload.payment?.entity
            if (!payment) {
                console.error("[Razorpay Webhook] ❌ Missing payment entity in payload")
                return res.status(200).json({ status: "ok", message: "No payment entity" })
            }

            const orderId = payment.order_id
            const paymentId = payment.id
            const amount = payment.amount   // in paise
            const method = payment.method

            console.log(`[Razorpay Webhook] Processing payment: orderId=${orderId}, paymentId=${paymentId}, method=${method}`)

            const transaction = await Transaction.findOneAndUpdate(
                { orderId: orderId, status: { $ne: "completed" } },
                {
                    $set: {
                        status: "completed",
                        paymentId: paymentId,
                        updatedAt: new Date(),
                        "notes.razorpay_webhook_event": event.event,
                        "notes.razorpay_payment_method": method,
                        "notes.completed_via": "razorpay_webhook",
                    },
                },
                { new: true }
            )

            if (transaction) {
                console.log(`✅ [Razorpay Webhook] Transaction ${orderId} → completed (paymentId: ${paymentId})`)

                // Notify frontend via SSE
                sseManager.broadcast(orderId, {
                    type: "payment_success",
                    orderId: orderId,
                    status: "completed",
                    paymentId: paymentId,
                    source: "razorpay_webhook",
                })
                console.log(`📡 [Razorpay Webhook] SSE broadcast sent for ${orderId}`)
            } else {
                const existing = await Transaction.findOne({ orderId })
                if (!existing) {
                    console.error(`❌ [Razorpay Webhook] Transaction NOT FOUND for orderId: ${orderId}`)
                    console.error("👉 Hint: Check that the orderId in Razorpay matches the 'orderId' field in MongoDB")
                } else {
                    console.log(`ℹ️ [Razorpay Webhook] Transaction ${orderId} already has status=${existing.status}. Idempotency skip.`)
                }
            }
        } else if (event.event === "payment.failed") {
            const payment = event.payload.payment?.entity
            if (payment) {
                const orderId = payment.order_id
                await Transaction.findOneAndUpdate(
                    { orderId: orderId, status: "pending" },
                    {
                        $set: {
                            status: "failed",
                            updatedAt: new Date(),
                            "notes.razorpay_failure_reason": payment.error_description,
                            "notes.razorpay_failure_code": payment.error_code,
                        }
                    },
                    { new: true }
                )
                console.log(`[Razorpay Webhook] Payment failed for orderId: ${orderId}. Reason: ${payment.error_description}`)
            }
        } else {
            console.log(`[Razorpay Webhook] ℹ️ Unhandled event: ${event.event} — returning 200 OK`)
        }

        return res.status(200).json({ status: "ok" })

    } catch (error: any) {
        console.error("[Razorpay Webhook] 🔥 SYSTEM ERROR:", error.message, error.stack)
        return res.status(500).json({ status: "error", message: error.message })
    }
}
