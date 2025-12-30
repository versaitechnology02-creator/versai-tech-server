import axios from "axios"
import unpayClient, {
  UNPAY_PARTNER_ID,
  UNPAY_API_KEY,
  UNPAY_AES_KEY,
  UNPAY_IV,
} from "../config/unpay"
import crypto from "crypto"
import net from "net"

/**
 * Public client for UnPay endpoints that DO NOT require api-key
 * (Important for /getip)
 */
const unpayPublicClient = axios.create({
  baseURL: "https://unpay.in/tech/api",
  timeout: 15000,
})

/**
 * Validate AES credentials at startup
 */
function validateAesConfig() {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length !== 32) {
    throw new Error("UNPAY_AES_KEY must be exactly 32 characters")
  }
  if (!UNPAY_IV || UNPAY_IV.length !== 16) {
    throw new Error("UNPAY_IV must be exactly 16 characters")
  }
}

/**
 * AES-256-CBC encryption (HEX, lowercase – UnPay compatible)
 */
function encryptAES(data: string): string {
  validateAesConfig()

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(UNPAY_IV, "utf8")
  )

  let encrypted = cipher.update(data, "utf8", "hex")
  encrypted += cipher.final("hex")
  return encrypted // ❗ DO NOT uppercase unless UnPay explicitly says so
}

/**
 * AES-256-CBC decryption (HEX, lowercase – UnPay compatible)
 */
function decryptAES(encryptedData: string): string {
  validateAesConfig()

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(UNPAY_IV, "utf8")
  )

  let decrypted = decipher.update(encryptedData, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

/**
 * Fetch server public IP from UnPay
 * Equivalent to:
 * curl https://unpay.in/tech/api/getip
 */
export async function getUnpayIp(): Promise<string> {
  try {
    console.log("[UnPay] Fetching server IP...")

    const resp = await unpayPublicClient.get("/getip")

    console.log("[UnPay] Raw IP response:", resp.data)

    const ip =
      resp.data?.ip ||
      resp.data?.server_ip ||
      resp.data?.data?.ip ||
      resp.data?.data?.server_ip

    if (!ip || !net.isIP(ip)) {
      // If IP is undefined or invalid, use a fallback or skip IP requirement
      console.warn("[UnPay] IP not available or invalid, proceeding without IP whitelisting")
      return "127.0.0.1" // Fallback IP for development
    }

    console.log("[UnPay] Server IP:", ip)
    return ip
  } catch (err: any) {
    console.error("[UnPay] Get IP error (FULL):", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    })
    // Don't throw error, return fallback IP
    console.warn("[UnPay] Failed to get IP, using fallback")
    return "127.0.0.1"
  }
}

/**
 * Create UnPay Pay-In transaction
 */
export async function createUnpayTransaction(payload: {
  amount: number
  currency?: string
  description?: string
  customer?: { name?: string; email?: string; phone?: string }
  metadata?: Record<string, any>
  client_ip?: string
}) {
  console.log("[UnPay] Creating transaction with payload:", payload)

  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing in environment variables")
  }

  validateAesConfig()

  // Amount must be INTEGER rupees
  const amount = Number(payload.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a positive integer (rupees)")
  }

  const orderId =
    payload.metadata?.razorpay_order_id ||
    payload.metadata?.order_id ||
    `unpay_${Date.now()}`

  // Use production callback URL - UnPay requires whitelisted IP
  const callbackUrl = process.env.UNPAY_CALLBACK_URL || 
                     process.env.SERVER_URL || 
                     `https://payments.versaitechnology.com/api/payments/webhook/unpay`

  const requestBody: any = {
    partner_id: UNPAY_PARTNER_ID,
    txnid: orderId,
    amount: String(amount),
    currency: payload.currency || "INR",
    callback: callbackUrl,
  }

  // Attach client IP if provided (UnPay requires customer IP / ip_address)
  if (payload.client_ip) {
    requestBody.customer_ip = payload.client_ip
    // Also include ip_address for compatibility if UnPay expects that key
    requestBody.ip_address = payload.client_ip
  }

  console.log(
    "[UnPay] Request body (before encryption):",
    JSON.stringify(requestBody, null, 2)
  )

  const encryptedBody = encryptAES(JSON.stringify(requestBody))

  console.log("[UnPay] Encrypted request body:", encryptedBody)

  try {
    const resp = await unpayClient.post("/payin/order/create", {
      body: encryptedBody,
    })

    console.log(
      "[UnPay] Create payment response:",
      JSON.stringify(resp.data, null, 2)
    )

    const data = resp.data

    if (data.statuscode !== "TXN") {
      throw new Error(data.message || "UnPay order creation failed")
    }

    return {
      raw: data,
      order_id: orderId,
      transaction_id: data.upi_tr || data.txnid,
      upi_reference: data.upi_tr,
      upi_intent: data.upi_string,
      payment_url:
        data.upi_string || data.upi_intent || data.payment_link,
    }
  } catch (err: any) {
    console.error("[UnPay] Create payment error (FULL):", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    })

    throw new Error(
      err.response?.data?.message ||
        err.response?.data?.error ||
        "UnPay transaction failed"
    )
  }
}

/**
 * Create UnPay Dynamic QR
 */
export async function createUnpayDynamicQR(payload: {
  amount: number
  apitxnid: string
  webhook?: string
}) {
  console.log("[UnPay Dynamic QR] Creating QR with payload:", payload)

  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing in environment variables")
  }

  validateAesConfig()

  // Amount must be a number
  const amount = Number(payload.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number")
  }

  const requestBody = {
    partner_id: UNPAY_PARTNER_ID,
    apitxnid: payload.apitxnid,
    amount: amount,
    webhook: payload.webhook || `https://payments.versaitechnology.com/api/payments/webhook/unpay`,
  }

  console.log(
    "[UnPay Dynamic QR] Request body (before encryption):",
    JSON.stringify(requestBody, null, 2)
  )

  const encryptedBody = encryptAES(JSON.stringify(requestBody))

  console.log("[UnPay Dynamic QR] Encrypted request body:", encryptedBody)

  try {
    const resp = await unpayClient.post("/next/upi/request/qr", {
      body: encryptedBody,
    })

    console.log(
      "[UnPay Dynamic QR] Response:",
      JSON.stringify(resp.data, null, 2)
    )

    const data = resp.data

    if (data.status !== "TXN") {
      throw new Error(data.message || "UnPay Dynamic QR creation failed")
    }

    return {
      apitxnid: data.data.apitxnid,
      qrString: data.data.qrString,
      time: data.data.time,
    }
  } catch (err: any) {
    console.error("[UnPay Dynamic QR] Error (FULL):", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    })

    throw new Error(
      err.response?.data?.message ||
        err.response?.data?.error ||
        "UnPay Dynamic QR failed"
    )
  }
}

export { decryptAES, encryptAES }
