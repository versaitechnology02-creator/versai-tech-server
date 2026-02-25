/**
 * RezoPay Payout Service
 * ======================
 * Handles all outbound calls to the RezoPay Payout API (pg.sdmrc.in).
 *
 * API Base  : https://pg.sdmrc.in/api/v2
 * Auth      : x-api-key header (no body encryption required for RezoPay payout)
 * Endpoints :
 *   POST /bank/payout         — Initiate payout
 *   POST /bank/check-status   — Check payout status
 *   POST /check-balance       — Check payout wallet balance
 *
 * Design decisions:
 * - All env vars validated at call time (not at module load) so server starts
 *   even if RezoPay is not yet configured, and fails loudly only when called.
 * - Timeout: 20s (bank APIs can be slow; 15s was too tight in testing)
 * - Error messages are SANITIZED before bubbling up — no raw gateway errors
 *   are exposed to the client.
 */

import axios, { AxiosError } from "axios"
import https from "https"

// Force IPv4 to avoid IPv6 routing issues on cloud infra
const httpsAgent = new https.Agent({ family: 4, keepAlive: true })

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InitiatePayoutPayload {
    orderid: string       // Our unique idempotency key
    fullName: string      // Beneficiary full name
    amount: number        // Amount in INR (numeric, not string)
    mobile: string        // 10-digit mobile
    accountNumber: string // Bank account number
    ifsc: string          // IFSC code
    bank: string          // Bank name
}

export interface RezopayInitiateResponse {
    status: string        // "pending" | "failed"
    message: string
}

export interface RezopayStatusResponse {
    status: string        // "success" | "failed" | (outer wrapper)
    message: string
    data?: {
        status: string      // "success" | "failed" | "pending"
        orderid: string
        utr: string
    }
}

export interface RezopayBalanceResponse {
    status: string        // "success" | "failed"
    balance?: number
    message?: string
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Validate required RezoPay env vars.
 * Called at the start of every service function — fail loudly, fail early.
 */
function getRezoPayConfig(): { apiKey: string; baseUrl: string } {
    const apiKey = process.env.REZOPAY_API_KEY
    const baseUrl = (
        process.env.REZOPAY_BASE_URL || "https://pg.sdmrc.in/api"
    ).replace(/\/$/, "")

    if (!apiKey) {
        throw new Error(
            "REZOPAY_API_KEY is not configured in environment variables. " +
            "Please add it to your .env file."
        )
    }

    return { apiKey, baseUrl }
}

/**
 * Sanitize error messages before surfacing them.
 * We never leak raw Axios error bodies or stack traces to callers.
 */
function sanitizeGatewayError(error: unknown, context: string): Error {
    if (error instanceof AxiosError) {
        const status = error.response?.status
        const data = error.response?.data

        // Log full detail server-side
        console.error(`[RezoPay ${context}] HTTP ${status}:`, JSON.stringify(data))

        // Return sanitized message to caller
        if (status === 401 || status === 403) {
            return new Error("RezoPay authentication failed — check REZOPAY_API_KEY")
        }
        if (status === 429) {
            return new Error("RezoPay rate limit exceeded — please retry after a short delay")
        }
        if (status && status >= 500) {
            return new Error("RezoPay gateway is temporarily unavailable — please retry")
        }
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
            return new Error("RezoPay request timed out — gateway may be slow, please retry")
        }

        return new Error(data?.message || "RezoPay gateway error — please retry")
    }

    if (error instanceof Error) {
        // Re-throw our own validation errors as-is
        return error
    }

    return new Error("Unknown RezoPay service error")
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Initiate a bank payout via RezoPay.
 *
 * RezoPay REQUIRES your server IP to be whitelisted.
 * If you get "IP not allowed" errors, contact RezoPay support.
 *
 * Returns: { status: "pending" | "failed", message: string }
 */
export async function initiateRezoPayout(
    payload: InitiatePayoutPayload
): Promise<RezopayInitiateResponse> {
    const { apiKey, baseUrl } = getRezoPayConfig()

    const endpoint = `${baseUrl}/v2/bank/payout`

    // RezoPay expects amount as a number (not string)
    const body = {
        orderid: payload.orderid,
        fullName: payload.fullName.trim(),
        mobile: payload.mobile.trim(),
        accountNumber: payload.accountNumber.trim(),
        ifsc: payload.ifsc.trim().toUpperCase(),
        bank: payload.bank.trim(),
        amount: Number(payload.amount),
    }

    console.log(`[RezoPay Payout] Initiating payout → orderid=${payload.orderid} amount=${payload.amount}`)

    try {
        const response = await axios.post<RezopayInitiateResponse>(endpoint, body, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "x-api-key": apiKey,
            },
            timeout: 20000, // 20s — bank APIs can be slow
            httpsAgent,
        })

        console.log(
            `[RezoPay Payout] Response → orderid=${payload.orderid} status=${response.data?.status} message=${response.data?.message}`
        )

        return response.data

    } catch (error) {
        throw sanitizeGatewayError(error, "initiateRezoPayout")
    }
}

/**
 * Check the current status of a payout transaction.
 *
 * Returns full status object including UTR on success.
 */
export async function checkRezoPayoutStatus(
    orderid: string
): Promise<RezopayStatusResponse> {
    const { apiKey, baseUrl } = getRezoPayConfig()

    const endpoint = `${baseUrl}/v2/bank/check-status`

    console.log(`[RezoPay Status] Checking status → orderid=${orderid}`)

    try {
        const response = await axios.post<RezopayStatusResponse>(
            endpoint,
            { orderid },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-api-key": apiKey,
                },
                timeout: 15000,
                httpsAgent,
            }
        )

        console.log(
            `[RezoPay Status] Response → orderid=${orderid}:`,
            JSON.stringify(response.data)
        )

        return response.data

    } catch (error) {
        throw sanitizeGatewayError(error, "checkRezoPayoutStatus")
    }
}

/**
 * Check the current payout wallet balance on RezoPay.
 *
 * NOTE: The docs say POST /check-balance with body { type: "payout" }.
 * The base URL for this endpoint is v1 (no /v2 prefix).
 */
export async function checkRezoPayoutBalance(): Promise<RezopayBalanceResponse> {
    const { apiKey, baseUrl } = getRezoPayConfig()

    // Balance endpoint is NOT under /v2 per the API docs
    const endpoint = `${baseUrl}/check-balance`

    console.log("[RezoPay Balance] Checking payout wallet balance...")

    try {
        const response = await axios.post<RezopayBalanceResponse>(
            endpoint,
            { type: "payout" },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-api-key": apiKey,
                },
                timeout: 10000,
                httpsAgent,
            }
        )

        console.log(
            "[RezoPay Balance] Response:",
            JSON.stringify(response.data)
        )

        return response.data

    } catch (error) {
        throw sanitizeGatewayError(error, "checkRezoPayoutBalance")
    }
}
