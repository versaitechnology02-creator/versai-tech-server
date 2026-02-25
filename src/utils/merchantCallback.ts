/**
 * Merchant Callback Utility
 * =========================
 * Fires async HTTP POST callbacks to merchant-specified URLs when
 * a payment is completed or failed.
 *
 * Merchants pass `callbackUrl` when creating an order; we POST to it
 * when payment status changes.
 *
 * Security: Only fires to valid https:// URLs (or http:// for localhost/dev).
 * Timeout: 8s
 */

import axios from "axios"
import Transaction from "../models/Transaction"

export interface MerchantCallbackPayload {
    event: "payment.success" | "payment.failed" | "payment.pending"
    orderId: string
    paymentId: string
    amount: number
    currency: string
    status: "completed" | "failed" | "pending"
    message: string
    timestamp: string
    utr?: string
    gatewayId?: string
}

/**
 * Fire a POST request to the merchant's callback URL.
 * Non-blocking — errors are logged but never thrown.
 */
export async function fireMerchantCallback(
    callbackUrl: string | null | undefined,
    payload: MerchantCallbackPayload
): Promise<void> {
    if (!callbackUrl) return

    // Validate URL format
    let parsedUrl: URL
    try {
        parsedUrl = new URL(callbackUrl)
    } catch (_e) {
        console.warn(`[MerchantCallback] Invalid callback URL: ${callbackUrl}`)
        return
    }

    // Only allow https:// (and http://localhost for dev)
    const isLocalhost =
        parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1"
    if (parsedUrl.protocol !== "https:" && !isLocalhost) {
        console.warn(`[MerchantCallback] Blocked non-HTTPS callback URL: ${callbackUrl}`)
        return
    }

    console.log(
        `[MerchantCallback] Firing callback → ${callbackUrl} event=${payload.event} orderId=${payload.orderId}`
    )

    try {
        const response = await axios.post(callbackUrl, payload, {
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "VersaiPay-Webhook/1.0",
                "X-VersaiPay-Event": payload.event,
            },
            timeout: 8000,
        })
        console.log(`[MerchantCallback] ✅ Success → ${callbackUrl} http=${response.status}`)
    } catch (err: any) {
        const status = err?.response?.status || "no-response"
        console.warn(`[MerchantCallback] ⚠️ Failed → ${callbackUrl} status=${status} error=${err.message}`)
    }
}

/**
 * Retrieve the merchant callback URL for a given orderId from DB.
 * Returns null if not set.
 */
export async function getMerchantCallbackUrl(orderId: string): Promise<string | null> {
    try {
        const tx = await Transaction.findOne({ orderId })
            .select("notes")
            .lean() as any
        return tx?.notes?.merchant_callback_url || null
    } catch (err: any) {
        console.warn("[MerchantCallback] Could not fetch callback URL:", err.message)
        return null
    }
}
