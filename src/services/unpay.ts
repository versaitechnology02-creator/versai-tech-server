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
      throw new Error(
        `Invalid IP received from UnPay: ${JSON.stringify(resp.data)}`
      )
    }

    console.log("[UnPay] Server IP:", ip)
    return ip
  } catch (err: any) {
    console.error("[UnPay] Get IP error (FULL):", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    })
    throw new Error("Failed to get UnPay server IP")
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
                     process.env.CALLBACK_URL ||
                     (process.env.CLIENT_URL && !process.env.CLIENT_URL.includes('localhost') 
                       ? `${process.env.CLIENT_URL}/api/unpay/callback`
                       : `https://payments.versaitechnology.com/api/unpay/callback`)

  const requestBody = {
    partner_id: UNPAY_PARTNER_ID,
    txnid: orderId,
    amount: String(amount),
    currency: payload.currency || "INR",
    callback: callbackUrl,
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
