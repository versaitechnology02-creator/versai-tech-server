import express, { Request, Response } from "express"
import crypto from "crypto"
import Transaction from "../models/Transaction"
// @ts-ignore
import { UNPAY_AES_KEY } from "../config/unpay"

const router = express.Router()

// ======================
// ENCRYPTION HELPER (AES-ECB)
// ======================
function decryptAESECB(encryptedText: string, key: string): string {
    try {
        // Standard AES-ECB Decryption
        const decipher = crypto.createDecipheriv("aes-256-ecb", Buffer.from(key), null)
        decipher.setAutoPadding(true)
        let decrypted = decipher.update(encryptedText, "hex", "utf8")
        decrypted += decipher.final("utf8")
        return decrypted
    } catch (err: any) {
        console.error(`[UnPay Decrypt Error]: ${err.message}`)
        // Return empty string or handle gracefully - do NOT throw
        return ""
    }
}

// ======================
// WEBHOOK CONTROLLER
// ======================
router.post("/callback", async (req: Request, res: Response) => {
    try {
        console.log("--------------- UNPAY WEBHOOK HIT ---------------")
        console.log("Headers:", JSON.stringify(req.headers))

        let payload: any = req.body
        const rawBodyForAudit = JSON.stringify(payload) // Store original

        console.log("Raw Body Type:", typeof payload)

        // 1. Decryption Logic
        // Check if body is encrypted structure: { body: "HEX..." }
        if (payload.body && typeof payload.body === "string") {
            console.log("[UnPay Webhook] Detected encrypted body. Decrypting...")

            const decryptedString = decryptAESECB(payload.body, UNPAY_AES_KEY)

            if (!decryptedString) {
                console.error("[UnPay Webhook] Decryption failed or returned empty.")
                // LOG RAW BODY FOR DEBUG
                console.error("Encrypted Payload was:", payload.body)
                return res.status(200).json({ status: "success", message: "Decryption Failed - Logged" })
            }

            console.log("[UnPay Webhook] Decryption Success:", decryptedString)
            try {
                payload = JSON.parse(decryptedString)
            } catch (parseErr) {
                console.error("[UnPay Webhook] JSON Parse Error of decrypted body")
                return res.status(200).json({ status: "success", message: "JSON Parse Failed" })
            }
        } else {
            console.log("[UnPay Webhook] Plaintext body detected (or unexpected format):", JSON.stringify(payload))
        }

        // 2. Extract Fields
        // Map webhook fields to our internal fields
        // API Spec: apitxnid = Our Unique Order ID
        //           txnid = UnPay Payment ID (Bank Ref)
        //           statuscode = TXN (Success), ERR (Failed), PND (Pending)
        const orderId = payload.apitxnid
        const paymentId = payload.txnid
        const statusFn = payload.statuscode
        const message = payload.message || ""

        if (!orderId) {
            console.warn("[UnPay Webhook] Missing 'apitxnid' (orderId). Ignoring.")
            return res.status(200).json({ status: "success", message: "Missing orderId" })
        }

        // 3. Status Mapping
        let newStatus = "pending"
        if (statusFn === "TXN") {
            newStatus = "completed"
        } else if (["ERR", "FAL", "REF"].includes(statusFn)) {
            newStatus = "failed"
        }

        console.log(`[UnPay Webhook] Order: ${orderId}, Status: ${statusFn} -> ${newStatus}`)

        // 4. Atomic Update & Idempotency
        // We strive to update ONLY if not already completed/failed final state
        // AND store the raw webhook data in 'notes'

        const updateResult = await Transaction.findOneAndUpdate(
            {
                orderId: orderId,
                status: { $ne: "completed" } // IDEMPOTENCY: Don't touch if already completed
            },
            {
                $set: {
                    status: newStatus,
                    paymentId: paymentId,
                    "notes.webhook_response": payload,
                    "notes.webhook_raw": rawBodyForAudit,
                    updatedAt: new Date()
                }
            },
            { new: true }
        )

        if (updateResult) {
            console.log(`[UnPay Webhook] DB Updated: ${orderId} is now ${updateResult.status}`)
        } else {
            // Either not found OR already completed
            // Let's check which one
            const existing = await Transaction.findOne({ orderId })
            if (!existing) {
                console.warn(`[UnPay Webhook] Order ${orderId} NOT FOUND in DB.`)
            } else {
                console.log(`[UnPay Webhook] Order ${orderId} was already ${existing.status}. No update performed.`)
            }
        }

        // 5. Final Response (ALWAYS 200)
        return res.status(200).json({ status: "success", message: "Webhook processed" })

    } catch (error: any) {
        console.error("[UnPay Webhook] CRITICAL ERROR (Caught):", error.message)
        console.error(error.stack)
        // CRITICAL REQUIREMENT: Always return 200
        return res.status(200).json({ status: "success", message: "Internal Error" })
    }
})

export default router
