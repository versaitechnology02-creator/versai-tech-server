import axios from "axios"
import https from "https"
import crypto from "crypto"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY, UNPAY_AES_KEY } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (AES-128-ECB)
// ==========================================

// Create HTTPS Agent to force IPv4
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
})

// ======================
// ENCRYPTION HELPER
// ======================

function encryptAES128(text: string): string {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length < 16) {
    throw new Error(`Invalid AES Key length: ${UNPAY_AES_KEY?.length}. Must be at least 16 chars.`)
  }

  // 1. Key: First 16 bytes
  const key = Buffer.from(UNPAY_AES_KEY.substring(0, 16), "utf8")

  // 2. Algorithm: aes-128-ecb
  const algorithm = "aes-128-ecb"

  // 3. Create Cipher (Auto Padding = PKCS7)
  const cipher = crypto.createCipheriv(algorithm, key, null)
  cipher.setAutoPadding(true)

  // 4. Encrypt
  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")

  // 5. Output: HEX UPPERCASE
  return encrypted.toUpperCase()
}

// ======================
// Create Dynamic QR (PRODUCTION)
// ======================

export async function createUnpayDynamicQR(payload: {
  amount: number
  apitxnid: string
  webhook?: string
}) {
  console.log("[UnPay QR] Starting Creation Process (AES-128-ECB)...")

  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing (Partner ID or API Key)")
  }

  const amount = Number(payload.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}. Must be positive integer.`)
  }

  const webhook =
    payload.webhook || process.env.UNPAY_WEBHOOK_URL

  if (!webhook) {
    throw new Error("Webhook URL missing. Set UNPAY_WEBHOOK_URL in environment.")
  }

  // ✅ FINAL INNER PAYLOAD (ALL STRINGS — IMPORTANT)
  const innerPayload = {
    partner_id: String(UNPAY_PARTNER_ID),
    amount: String(amount),
    apitxnid: String(payload.apitxnid),
    webhook: String(webhook)
  }

  // 1️⃣ Stringify
  const jsonString = JSON.stringify(innerPayload)
  console.log("[UnPay QR] Raw JSON:", jsonString)

  // 2️⃣ Encrypt (AES-128-ECB → HEX → UPPERCASE)
  let encryptedHex: string
  try {
    encryptedHex = encryptAES128(jsonString)
    console.log(
      `[UnPay QR] Encrypted HEX (Len: ${encryptedHex.length}):`,
      encryptedHex.substring(0, 50) + "..."
    )
  } catch (err: any) {
    console.error("[UnPay QR] Encryption Failed:", err.message)
    throw err
  }

  // 3️⃣ Wrap Body
  const requestBody = {
    body: encryptedHex
  }

  console.log("[UnPay QR] Final Request Body:", JSON.stringify(requestBody))

  // 4️⃣ Final URL
  const baseUrl = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "")
  const finalUrl = `${baseUrl}/next/upi/request/qr`

  console.log("[UnPay QR] Sending Request to:", finalUrl)

  try {
    const response = await axios.post(
      finalUrl,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "api-key": UNPAY_API_KEY.trim()
        },
        timeout: 15000,
        httpsAgent: httpsAgent
      }
    )

    console.log("[UnPay QR] Response Status:", response.status)
    console.log("[UnPay QR] Response Data:", JSON.stringify(response.data))

    if (response.data?.statuscode !== "TXN") {
      throw new Error(response.data?.message || "UnPay returned error")
    }

    return response.data

  } catch (error: any) {
    console.error(
      "[UnPay QR] API Error:",
      error.response?.data || error.message
    )
    throw new Error(
      error.response?.data?.message || error.message
    )
  }
}

// ======================
// Create Pay-In Order (Legacy Support)
// ======================

export async function createUnpayTransaction(payload: {
  amount: number
  metadata?: Record<string, any>
}) {
  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) throw new Error("UnPay credentials missing")

  const amount = Number(payload.amount)

  const orderId = payload.metadata?.order_id || `ANTBBPS${Date.now()}`
  const webhookUrl = process.env.UNPAY_WEBHOOK_URL

  const body = {
    partner_id: String(UNPAY_PARTNER_ID),
    apitxnid: orderId,
    amount: Number(amount),
    webhook: webhookUrl,
  };

  try {
    const resp = await unpayClient.post("/payin/order/create", body, {
      httpsAgent: httpsAgent
    })
    if (resp.data?.statuscode !== "TXN") {
      throw new Error(resp.data?.message || "Order failed")
    }
    return {
      raw: resp.data,
      order_id: orderId,
      txnid: resp.data.txnid,
      upi: resp.data.upi_string,
    }
  } catch (err: any) {
    throw new Error("UnPay order creation failed")
  }
}