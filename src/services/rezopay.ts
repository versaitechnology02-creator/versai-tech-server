/**
 * RezoPay (RudraxPay) Payout Service
 * ====================================
 * Handles all outbound calls to the RezoPay/RudraxPay Payout API (pg.sdmrc.in).
 *
 * ⚠️  AUTHENTICATION (from official API docs):
 *   Headers: saltkey + secretkey  (NOT x-api-key)
 *
 * Endpoints used:
 *   POST https://pg.sdmrc.in/api/v2/bank/payout         — Initiate payout
 *   POST https://pg.sdmrc.in/api/v2/bank/check-status   — Check payout status
 *   POST https://pg.sdmrc.in/api/check-balance           — Balance check (no /v2)
 *
 * Design:
 * - Env vars validated at call time — server starts even if keys not set
 * - 20s timeout on payout initiation (bank APIs are slow)
 * - All gateway errors are sanitized before surfacing to client
 * - IPv4 forced to avoid IPv6 routing issues on Linux cloud servers
 */

import axios, { AxiosError } from "axios"
import https from "https"

// Force IPv4 — avoids IPv6 routing issues common on VPS/cloud
const httpsAgent = new https.Agent({ family: 4, keepAlive: true })

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InitiatePayoutPayload {
    orderid: string        // Unique idempotency key (our POUT... key)
    fullName: string       // Beneficiary full name
    amount: number         // Amount in INR
    mobile: string         // 10-digit mobile number
    accountNumber: string  // Bank account number
    ifsc: string           // IFSC code (uppercase)
    bank: string           // Bank name
}

export interface RezopayInitiateResponse {
    status: string     // "pending" | "failed"
    message: string
}

export interface RezopayStatusResponse {
    status: string     // outer: "success" | "failed"
    message: string
    data?: {
        status: string     // inner: "success" | "failed" | "pending"
        orderid: string
        utr: string
    }
}

export interface RezopayBalanceResponse {
    status: string     // "success" | "failed"
    balance?: number
    message?: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Read and validate RezoPay credentials from env.
 * Called at the top of every service function — fails loudly, fails early.
 *
 * According to API docs (pg.sdmrc.in):
 *   Header: saltkey    = REZOPAY_SALT_KEY
 *   Header: secretkey  = REZOPAY_SECRET_KEY
 */
function getRezoPayConfig(): {
    saltKey: string
    secretKey: string
    baseUrl: string
} {
    const saltKey = process.env.REZOPAY_SALT_KEY
    const secretKey = process.env.REZOPAY_SECRET_KEY
    const baseUrl = (
        process.env.REZOPAY_BASE_URL || "https://pg.sdmrc.in/api"
    ).replace(/\/$/, "")

    if (!saltKey) {
        throw new Error(
            "REZOPAY_SALT_KEY is not set in .env — add it from your RudraxPay merchant panel"
        )
    }
    if (!secretKey) {
        throw new Error(
            "REZOPAY_SECRET_KEY is not set in .env — add it from your RudraxPay merchant panel"
        )
    }

    return { saltKey, secretKey, baseUrl }
}

/**
 * Build the standard auth headers required by pg.sdmrc.in API.
 * Per official docs: saltkey + secretkey in headers.
 */
function buildHeaders(saltKey: string, secretKey: string) {
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "saltkey": saltKey,
        "secretkey": secretKey,
    }
}

// ─── Error Handling ───────────────────────────────────────────────────────────

function sanitizeGatewayError(error: unknown, context: string): Error {
    if (error instanceof AxiosError) {
        const status = error.response?.status
        const data = error.response?.data

        // Full details server-side only
        console.error(
            `[RezoPay ${context}] HTTP ${status ?? "no-response"}:`,
            JSON.stringify(data ?? error.message)
        )

        if (status === 401 || status === 403) {
            return new Error(
                "RezoPay authentication failed — check REZOPAY_SALT_KEY and REZOPAY_SECRET_KEY in .env"
            )
        }
        if (status === 429) {
            return new Error("RezoPay rate limit exceeded — please retry after a short delay")
        }
        if (status && status >= 500) {
            return new Error("RezoPay gateway unavailable — please retry")
        }
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
            return new Error("RezoPay request timed out — gateway may be slow, please retry")
        }
        if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
            return new Error("Cannot reach RezoPay gateway — check REZOPAY_BASE_URL in .env")
        }

        return new Error(data?.message || "RezoPay gateway error — please retry")
    }

    if (error instanceof Error) return error

    return new Error("Unknown RezoPay service error")
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Initiate a bank payout via RezoPay.
 *
 * ⚠️  Your server IP MUST be whitelisted by RezoPay support first.
 *     If you get "IP not allowed" or auth errors, contact RezoPay support.
 *
 * Endpoint: POST https://pg.sdmrc.in/api/v2/bank/payout
 * Returns: { status: "pending" | "failed", message: string }
 */
export async function initiateRezoPayout(
    payload: InitiatePayoutPayload
): Promise<RezopayInitiateResponse> {
    const { saltKey, secretKey, baseUrl } = getRezoPayConfig()

    const endpoint = `${baseUrl}/v2/bank/payout`

    const body = {
        orderid: payload.orderid,
        fullName: payload.fullName.trim(),
        mobile: payload.mobile.trim(),
        accountNumber: payload.accountNumber.trim(),
        ifsc: payload.ifsc.trim().toUpperCase(),
        bank: payload.bank.trim(),
        amount: Number(payload.amount),
    }

    console.log(
        `[RezoPay Payout] Initiating → orderid=${payload.orderid} amount=₹${payload.amount} endpoint=${endpoint}`
    )

    try {
        const response = await axios.post<RezopayInitiateResponse>(
            endpoint,
            body,
            {
                headers: buildHeaders(saltKey, secretKey),
                timeout: 20000,
                httpsAgent,
            }
        )

        console.log(
            `[RezoPay Payout] ✅ Response → orderid=${payload.orderid}`,
            JSON.stringify(response.data)
        )

        return response.data

    } catch (error) {
        throw sanitizeGatewayError(error, "initiateRezoPayout")
    }
}

/**
 * Check the current status of a payout by orderid.
 *
 * Endpoint: POST https://pg.sdmrc.in/api/v2/bank/check-status
 */
export async function checkRezoPayoutStatus(
    orderid: string
): Promise<RezopayStatusResponse> {
    const { saltKey, secretKey, baseUrl } = getRezoPayConfig()

    const endpoint = `${baseUrl}/v2/bank/check-status`

    console.log(`[RezoPay Status] Checking → orderid=${orderid}`)

    try {
        const response = await axios.post<RezopayStatusResponse>(
            endpoint,
            { orderid },
            {
                headers: buildHeaders(saltKey, secretKey),
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
 * Check the RezoPay payout wallet balance.
 *
 * Endpoint: POST https://pg.sdmrc.in/api/check-balance (no /v2!)
 * Body: { "type": "payout" }
 */
export async function checkRezoPayoutBalance(): Promise<RezopayBalanceResponse> {
    const { saltKey, secretKey, baseUrl } = getRezoPayConfig()

    // Balance endpoint has NO /v2 prefix — per official API docs
    const endpoint = `${baseUrl}/check-balance`

    console.log("[RezoPay Balance] Checking payout wallet balance...")

    try {
        const response = await axios.post<RezopayBalanceResponse>(
            endpoint,
            { type: "payout" },
            {
                headers: buildHeaders(saltKey, secretKey),
                timeout: 10000,
                httpsAgent,
            }
        )

        console.log("[RezoPay Balance] Response:", JSON.stringify(response.data))

        return response.data

    } catch (error) {
        throw sanitizeGatewayError(error, "checkRezoPayoutBalance")
    }
}
