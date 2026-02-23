/**
 * Payment Status Polling Service
 * ================================
 * This service acts as a SAFETY NET when webhooks fail to arrive.
 *
 * It runs two background jobs:
 *  1. UnPay Poller  — polls UnPay's /payout/order/status API for pending transactions
 *  2. Razorpay Poller — polls Razorpay's order API for pending transactions
 *
 * Both jobs run every 2 minutes and skip transactions already older than 24 hours.
 */

import crypto from "crypto"
import axios from "axios"
import https from "https"
import Transaction from "../models/Transaction"
import { sseManager } from "./sse"

// ─────────────────────────────────────────────
// AES-256-CBC Encrypt (for UnPay order status)
// ─────────────────────────────────────────────
function encryptAES256CBC(text: string, key: string, iv: string): string {
    const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "utf8"), Buffer.from(iv, "utf8"))
    cipher.setAutoPadding(true)
    let encrypted = cipher.update(text, "utf8", "hex")
    encrypted += cipher.final("hex")
    return encrypted.toUpperCase()
}

// Shared HTTPS agent that forces IPv4
const httpsAgent = new https.Agent({ family: 4, keepAlive: true })

// ─────────────────────────────────────────────
// UNPAY ORDER STATUS POLL
// ─────────────────────────────────────────────
async function pollUnpayStatus(
    apitxnid: string,
    partnerId: string,
    apiKey: string,
    aesKey: string,
    iv: string,
    baseUrl: string
): Promise<{ statuscode: string; txnid?: string; utr?: string; amount?: number; status?: string } | null> {
    try {
        const innerPayload = {
            partner_id: String(partnerId),
            apitxnid: String(apitxnid),
        }

        const jsonString = JSON.stringify(innerPayload)
        const encryptedHex = encryptAES256CBC(jsonString, aesKey, iv)

        const requestBody = { body: encryptedHex }
        const url = `${baseUrl.replace(/\/$/, "")}/payout/order/status`

        const response = await axios.post(url, requestBody, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "api-key": apiKey.trim(),
            },
            timeout: 10000,
            httpsAgent,
        })

        return response.data
    } catch (err: any) {
        console.error(`[UnPay Poller] API error for ${apitxnid}:`, err.response?.data || err.message)
        return null
    }
}

// ─────────────────────────────────────────────
// RAZORPAY ORDER STATUS POLL
// ─────────────────────────────────────────────
async function pollRazorpayStatus(
    orderId: string,
    keyId: string,
    keySecret: string
): Promise<{ status: string; id: string } | null> {
    try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64")
        const response = await axios.get(`https://api.razorpay.com/v1/orders/${orderId}`, {
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
            },
            timeout: 10000,
        })
        return response.data
    } catch (err: any) {
        console.error(`[Razorpay Poller] API error for ${orderId}:`, err.response?.data || err.message)
        return null
    }
}

// ─────────────────────────────────────────────
// MAIN POLL LOOP — UnPay
// ─────────────────────────────────────────────
async function runUnpayPolling() {
    const partnerId = process.env.UNPAY_PARTNER_ID
    const apiKey = process.env.UNPAY_API_KEY
    const aesKey = process.env.UNPAY_AES_KEY
    const iv = process.env.UNPAY_IV
    const baseUrl = process.env.UNPAY_BASE_URL

    if (!partnerId || !apiKey || !aesKey || !iv || !baseUrl) {
        console.warn("[UnPay Poller] Skipping — missing UNPAY_PARTNER_ID / UNPAY_API_KEY / UNPAY_AES_KEY / UNPAY_IV / UNPAY_BASE_URL")
        return
    }

    // Find transactions where:
    // - status is still "pending"
    // - they have UnPay QR data (notes.unpay exists) meaning they went through UnPay
    // - created in the last 24 hours (avoid stale old orders)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

    let pendingTransactions: any[]
    try {
        pendingTransactions = await Transaction.find({
            status: "pending",
            "notes.unpay": { $exists: true },
            createdAt: { $gte: cutoff },
        }).limit(50)
    } catch (err: any) {
        console.error("[UnPay Poller] DB query failed:", err.message)
        return
    }

    if (pendingTransactions.length === 0) {
        console.log("[UnPay Poller] No pending UnPay transactions to poll.")
        return
    }

    console.log(`[UnPay Poller] 🔄 Polling ${pendingTransactions.length} pending UnPay transaction(s)...`)

    for (const txn of pendingTransactions) {
        const apitxnid = txn.orderId
        if (!apitxnid) continue

        const result = await pollUnpayStatus(apitxnid, partnerId, apiKey, aesKey, iv, baseUrl)
        if (!result) continue

        console.log(`[UnPay Poller] Result for ${apitxnid}:`, JSON.stringify(result))

        const statusCode = result.statuscode
        // Map UnPay statuscode to internal status
        // "TXN" = success, "No Record Found" = still pending/not processed yet
        let newStatus: string | null = null
        const updateData: Record<string, any> = {
            updatedAt: new Date(),
            "notes.poll_result": result,
        }

        if (statusCode === "TXN" && (result.status === "success" || result.status === "SUCCESS")) {
            newStatus = "completed"
            updateData.paymentId = result.txnid || apitxnid
            updateData["notes.utr"] = result.utr || ""
            updateData["notes.completed_via"] = "polling"
        } else if (statusCode === "TXN" && result.status === "failed") {
            newStatus = "failed"
            updateData["notes.completed_via"] = "polling"
        }
        // If "No Record Found" or pending — leave as-is

        if (!newStatus) {
            console.log(`[UnPay Poller] ${apitxnid} is still pending in UnPay. Skipping.`)
            continue
        }

        try {
            const updated = await Transaction.findOneAndUpdate(
                { orderId: apitxnid, status: { $ne: "completed" } },
                { $set: { status: newStatus, ...updateData } },
                { new: true }
            )

            if (updated) {
                console.log(`[UnPay Poller] ✅ UPDATED ${apitxnid} → ${newStatus} (via polling)`)

                if (newStatus === "completed") {
                    sseManager.broadcast(apitxnid, {
                        type: "payment_success",
                        orderId: apitxnid,
                        status: "completed",
                        paymentId: result.txnid,
                        utr: result.utr,
                        source: "polling",
                    })
                }
            }
        } catch (dbErr: any) {
            console.error(`[UnPay Poller] DB update failed for ${apitxnid}:`, dbErr.message)
        }

        // Small delay between requests to be a polite API consumer
        await new Promise((r) => setTimeout(r, 300))
    }
}

// ─────────────────────────────────────────────
// MAIN POLL LOOP — Razorpay
// ─────────────────────────────────────────────
async function runRazorpayPolling() {
    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET

    if (!keyId || !keySecret) {
        console.warn("[Razorpay Poller] Skipping — RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set")
        return
    }

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

    let pendingTransactions: any[]
    try {
        pendingTransactions = await Transaction.find({
            status: "pending",
            // Razorpay orders start with "order_"
            orderId: { $regex: /^order_/ },
            createdAt: { $gte: cutoff },
        }).limit(50)
    } catch (err: any) {
        console.error("[Razorpay Poller] DB query failed:", err.message)
        return
    }

    if (pendingTransactions.length === 0) {
        console.log("[Razorpay Poller] No pending Razorpay transactions to poll.")
        return
    }

    console.log(`[Razorpay Poller] 🔄 Polling ${pendingTransactions.length} pending Razorpay transaction(s)...`)

    for (const txn of pendingTransactions) {
        const orderId = txn.orderId
        if (!orderId) continue

        const result = await pollRazorpayStatus(orderId, keyId, keySecret)
        if (!result) continue

        console.log(`[Razorpay Poller] Result for ${orderId}: status=${result.status}`)

        let newStatus: string | null = null
        const updateData: Record<string, any> = {
            updatedAt: new Date(),
            "notes.razorpay_poll_result": result,
            "notes.completed_via": "polling",
        }

        // Razorpay order statuses: "created" | "attempted" | "paid"
        if (result.status === "paid") {
            newStatus = "completed"
        } else if (result.status === "attempted") {
            // Payment was attempted but may not have succeeded — keep pending
            console.log(`[Razorpay Poller] ${orderId} is in 'attempted' state. Keeping pending.`)
            continue
        }

        if (!newStatus) continue

        try {
            const updated = await Transaction.findOneAndUpdate(
                { orderId: orderId, status: { $ne: "completed" } },
                { $set: { status: newStatus, ...updateData } },
                { new: true }
            )

            if (updated) {
                console.log(`[Razorpay Poller] ✅ UPDATED ${orderId} → ${newStatus} (via polling)`)

                if (newStatus === "completed") {
                    sseManager.broadcast(orderId, {
                        type: "payment_success",
                        orderId: orderId,
                        status: "completed",
                        source: "polling",
                    })
                }
            }
        } catch (dbErr: any) {
            console.error(`[Razorpay Poller] DB update failed for ${orderId}:`, dbErr.message)
        }

        await new Promise((r) => setTimeout(r, 300))
    }
}

// ─────────────────────────────────────────────
// SCHEDULER — Starts both polling jobs
// ─────────────────────────────────────────────

let unpayPollInterval: NodeJS.Timeout | null = null
let razorpayPollInterval: NodeJS.Timeout | null = null

export function startPaymentPolling(): void {
    const POLL_INTERVAL_MS = 2 * 60 * 1000 // Every 2 minutes

    console.log(`[Payment Poller] 🚀 Starting polling service (every ${POLL_INTERVAL_MS / 1000}s)`)

    // Run immediately on start, then on interval
    runUnpayPolling().catch((e) => console.error("[UnPay Poller] Startup run error:", e.message))
    runRazorpayPolling().catch((e) => console.error("[Razorpay Poller] Startup run error:", e.message))

    unpayPollInterval = setInterval(() => {
        runUnpayPolling().catch((e) => console.error("[UnPay Poller] Interval error:", e.message))
    }, POLL_INTERVAL_MS)

    razorpayPollInterval = setInterval(() => {
        runRazorpayPolling().catch((e) => console.error("[Razorpay Poller] Interval error:", e.message))
    }, POLL_INTERVAL_MS)
}

export function stopPaymentPolling(): void {
    if (unpayPollInterval) clearInterval(unpayPollInterval)
    if (razorpayPollInterval) clearInterval(razorpayPollInterval)
    console.log("[Payment Poller] 🛑 Polling stopped.")
}
