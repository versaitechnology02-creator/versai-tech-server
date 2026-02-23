import express, { Request, Response } from "express"
import crypto from "crypto"
import Transaction from "../models/Transaction"
// @ts-ignore
import { UNPAY_AES_KEY, UNPAY_IV } from "../config/unpay"
import { sseManager } from "../utils/sse"

const router = express.Router()

// ======================
// DECRYPTION HELPERS
// ======================

/**
 * PRIMARY: Decrypt using AES-256-CBC
 * This MUST match the encryption in unpay.ts (createUnpayDynamicQR uses AES-256-CBC).
 */
function decryptAES256CBC(encryptedHex: string, key: string, iv: string): string {
    try {
        if (!key || key.length !== 32) {
            console.error(`[UnPay CBC Decrypt]: Invalid key length: ${key?.length}. Need exactly 32 chars.`)
            return ""
        }
        if (!iv || iv.length !== 16) {
            console.error(`[UnPay CBC Decrypt]: Invalid IV length: ${iv?.length}. Need exactly 16 chars.`)
            return ""
        }
        const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"))
        decipher.setAutoPadding(true)
        // UnPay sends HEX UPPERCASE — toLowerCase() normalizes it
        let decrypted = decipher.update(encryptedHex.toLowerCase(), "hex", "utf8")
        decrypted += decipher.final("utf8")
        return decrypted
    } catch (err: any) {
        console.error(`[UnPay CBC Decrypt Error]: ${err.message}`)
        return ""
    }
}

/**
 * FALLBACK: Decrypt using AES-256-ECB (legacy mode)
 */
function decryptAES256ECB(encryptedText: string, key: string): string {
    try {
        if (!key) {
            console.error("[UnPay ECB Decrypt Error]: Missing Key")
            return ""
        }
        const decipher = crypto.createDecipheriv("aes-256-ecb", Buffer.from(key), null)
        decipher.setAutoPadding(true)
        let decrypted = decipher.update(encryptedText, "hex", "utf8")
        decrypted += decipher.final("utf8")
        return decrypted
    } catch (err: any) {
        console.error(`[UnPay ECB Decrypt Error]: ${err.message}`)
        return ""
    }
}

// ======================
// WEBHOOK CONTROLLER
// ======================

// Connectivity Check (GET)
router.get("/callback", (req: Request, res: Response) => {
    res.status(200).json({ status: "success", message: "UnPay Webhook Endpoint Reachable" })
})

// Main Webhook Handler (POST)
router.post("/callback", async (req: Request, res: Response) => {
    try {
        console.log("============ UNPAY WEBHOOK HIT ============")
        console.log("[UnPay Webhook] Raw Body:", JSON.stringify(req.body, null, 2))

        // 1. Decryption & Payload Extraction
        let payload: any = req.body
        const rawBodyForAudit = JSON.stringify(payload)

        // Check if body is encrypted: { body: "HEXSTRING..." }
        if (payload.body && typeof payload.body === "string") {
            console.log("[UnPay Webhook] Encrypted body detected. Attempting AES-256-CBC decryption...")

            // PRIMARY: AES-256-CBC (matches QR creation in service/unpay.ts)
            let decryptedString = decryptAES256CBC(payload.body, UNPAY_AES_KEY, UNPAY_IV)

            // FALLBACK: AES-256-ECB (try if CBC fails — older integration style)
            if (!decryptedString) {
                console.warn("[UnPay Webhook] CBC decryption failed — trying ECB fallback...")
                decryptedString = decryptAES256ECB(payload.body, UNPAY_AES_KEY)
            }

            if (!decryptedString) {
                console.error("[UnPay Webhook] ❌ ALL decryption methods failed.")
                console.error("[UnPay Webhook] Encrypted hex (first 80 chars):", payload.body.substring(0, 80))
                // Return 200 so UnPay does NOT retry endlessly with same payload
                return res.status(200).json({ status: "success", message: "Decryption Failed - Acknowledged" })
            }

            try {
                payload = JSON.parse(decryptedString)
                console.log("[UnPay Webhook] ✅ Decrypted Payload:", JSON.stringify(payload, null, 2))
            } catch (parseErr) {
                console.error("[UnPay Webhook] JSON Parse Error. Decrypted string:", decryptedString.substring(0, 100))
                return res.status(200).json({ status: "success", message: "JSON Parse Failed" })
            }
        } else {
            // Plaintext payload (UnPay may sometimes send unencrypted)
            console.log("[UnPay Webhook] Plaintext Payload received:", JSON.stringify(payload, null, 2))
        }

        // 2. Extract Fields
        const orderId = payload.apitxnid       // Our internal order ID (set when creating QR)
        const paymentId = payload.txnid        // UnPay's transaction ID
        const utr = payload.utr || ""          // Bank UTR reference
        const statusCode = payload.statuscode  // "TXN" = success, "ERR"/"FAL"/"REF" = failure
        const message = payload.message || ""
        const amount = payload.amount

        if (!orderId) {
            console.warn("[UnPay Webhook] ⚠️ Missing 'apitxnid'. Cannot match to a transaction.")
            return res.status(200).json({ status: "success", message: "Missing apitxnid" })
        }

        console.log(`[UnPay Webhook] Processing: orderId=${orderId} | statuscode=${statusCode} | txnid=${paymentId} | utr=${utr}`)

        // 3. Status Mapping
        let newStatus = "pending"
        const updateData: any = {
            updatedAt: new Date(),
            "notes.webhook_response": payload,
            "notes.webhook_raw": rawBodyForAudit,
        }

        if (statusCode === "TXN") {
            newStatus = "completed"
            updateData.paymentId = paymentId || orderId
            updateData["notes.utr"] = utr
            if (!paymentId) console.warn("[UnPay Webhook] ⚠️ Successful TXN is missing 'txnid'")
        } else if (["ERR", "FAL", "REF", "FAIL"].includes(statusCode)) {
            newStatus = "failed"
            updateData["notes.failure_message"] = message
            updateData["notes.failure_code"] = statusCode
        } else {
            // Unknown status — keep as pending but log it
            console.warn(`[UnPay Webhook] Unknown statuscode: ${statusCode}. Keeping status=pending.`)
        }

        // 4. Atomic DB Update with Idempotency Guard
        // Only applies update if order is NOT already 'completed' — prevents overwriting success
        const transaction = await Transaction.findOneAndUpdate(
            {
                orderId: orderId,
                status: { $ne: "completed" }
            },
            {
                $set: {
                    status: newStatus,
                    ...updateData
                }
            },
            { new: true }
        )

        if (transaction) {
            console.log(`[UnPay Webhook] ✅ DB Updated: ${orderId} → status=${newStatus}`)

            // 5. Real-time SSE notification to frontend
            if (newStatus === "completed") {
                sseManager.broadcast(orderId, {
                    type: "payment_success",
                    orderId: orderId,
                    status: "completed",
                    paymentId: paymentId,
                    utr: utr,
                    amount: amount
                })
                console.log(`[UnPay Webhook] 📡 SSE broadcast sent for orderId=${orderId}`)
            }
        } else {
            // Either already completed or truly not found
            const existing = await Transaction.findOne({ orderId })
            if (!existing) {
                console.warn(`[UnPay Webhook] ⚠️ Order ${orderId} NOT FOUND in DB`)
            } else {
                console.log(`[UnPay Webhook] ℹ️ Order ${orderId} already has status=${existing.status}. Skipping.`)
            }
        }

        return res.status(200).json({ status: "success", message: "Processed" })

    } catch (error: any) {
        console.error("[UnPay Webhook] 🔥 SYSTEM ERROR:", error.message, error.stack)
        // Always return 200 — prevents UnPay from retrying with the same failing payload
        return res.status(200).json({ status: "success", message: "Internal Error Handled" })
    }
})

export default router
