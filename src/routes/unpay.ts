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
        if (!key) {
            console.error("[UnPay Decrypt Error]: Missing Key");
            return "";
        }
        // Standard AES-ECB Decryption
        const decipher = crypto.createDecipheriv("aes-256-ecb", Buffer.from(key), null)
        decipher.setAutoPadding(true)
        let decrypted = decipher.update(encryptedText, "hex", "utf8")
        decrypted += decipher.final("utf8")
        return decrypted
    } catch (err: any) {
        console.error(`[UnPay Decrypt Error]: ${err.message}`)
        return ""
    }
}

// ======================
// WEBHOOK CONTROLLER
// ======================
// Connectivity Check
router.get("/callback", (req: Request, res: Response) => {
    res.status(200).json({ status: "success", message: "UnPay Webhook Endpoint Reachable" })
})

router.post("/callback", async (req: Request, res: Response) => {
    try {
        console.log("--------------- UNPAY WEBHOOK HIT ---------------")

        // 1. Decryption & Payload Extraction
        let payload: any = req.body
        const rawBodyForAudit = JSON.stringify(payload)

        // Check if body is encrypted structure: { body: "HEX..." }
        if (payload.body && typeof payload.body === "string") {
            const decryptedString = decryptAESECB(payload.body, UNPAY_AES_KEY)

            if (!decryptedString) {
                console.error("[UnPay Webhook] Decryption Failed. Raw:", payload.body)
                return res.status(200).json({ status: "success", message: "Decryption Failed" })
            }

            try {
                payload = JSON.parse(decryptedString)
                console.log("[UnPay Webhook] Decrypted Payload:", JSON.stringify(payload, null, 2))
            } catch (parseErr) {
                console.error("[UnPay Webhook] JSON Parse Error")
                return res.status(200).json({ status: "success", message: "JSON Parse Failed" })
            }
        } else {
            console.log("[UnPay Webhook] Plaintext Payload:", JSON.stringify(payload, null, 2))
        }

        // 2. Extract Valid Fields
        const orderId = payload.apitxnid // Our internal Order ID
        const paymentId = payload.txnid // UnPay Ref ID
        const statusFn = payload.statuscode
        const message = payload.message || ""

        if (!orderId) {
            console.warn("[UnPay Webhook] Missing 'apitxnid'. Ignoring.")
            return res.status(200).json({ status: "success", message: "Missing Order ID" })
        }

        // 3. Status Mapping
        let newStatus = "pending"
        let updateData: any = {
            paymentId: paymentId,
            "notes.webhook_response": payload,
            "notes.webhook_raw": rawBodyForAudit,
            updatedAt: new Date()
        }

        if (statusFn === "TXN") {
            newStatus = "completed"
            // Ensure Payment ID is set
            if (!paymentId) console.warn("[UnPay Webhook] Warning: Successful TXN missing 'txnid'")
        } else if (["ERR", "FAL", "REF"].includes(statusFn)) {
            newStatus = "failed"
            // Store error message
            updateData["notes.failure_message"] = message
        }

        // 4. Atomic Update & Idempotency
        // Update ONLY if finding orderId AND status is NOT already completed
        // This prevents overwriting a success with a late failure or duplicate
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
            console.log(`[UnPay Webhook] SUCCESS: Updated ${orderId} to ${newStatus}`)
        } else {
            // Check if it was because order was missing or already completed
            const existing = await Transaction.findOne({ orderId })
            if (!existing) {
                console.warn(`[UnPay Webhook] IGNORED: Order ${orderId} not found in DB`)
            } else {
                console.log(`[UnPay Webhook] IGNORED: Order ${orderId} is already ${existing.status}`)
            }
        }

        return res.status(200).json({ status: "success", message: "Processed" })

    } catch (error: any) {
        console.error("[UnPay Webhook] SYSTEM ERROR:", error.message)
        // Always 200 to prevent retries
        return res.status(200).json({ status: "success", message: "Internal Error Handled" })
    }
})

export default router
