import axios from "axios"
import https from "https"
import crypto from "crypto"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY, UNPAY_AES_KEY, UNPAY_IV } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (AES-256-CBC)
// ==========================================

// Create HTTPS Agent to force IPv4
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
})

// ======================
// ENCRYPTION HELPER (AES-256-CBC + PKCS7)
// ======================

function encryptAES256CBC(text: string): string {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length !== 32) {
    throw new Error(`Invalid AES Key length: ${UNPAY_AES_KEY?.length}. Must be strictly 32 chars for AES-256.`)
  }

  if (!UNPAY_IV || UNPAY_IV.length !== 16) {
    throw new Error(`Invalid AES IV length: ${UNPAY_IV?.length}. Must be strictly 16 chars.`)
  }

  // 1. Key & IV
  const key = Buffer.from(UNPAY_AES_KEY, "utf8")
  const iv = Buffer.from(UNPAY_IV, "utf8")

  // 2. Algorithm: aes-256-cbc
  const algorithm = "aes-256-cbc"

  // 3. Create Cipher (Standard PKCS7 Padding)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  cipher.setAutoPadding(true) // Standard padding enabled

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
  console.log("[UnPay QR] Starting Creation Process (AES-256-CBC)...")

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

  // ✅ FINAL INNER PAYLOAD (ALL STRINGS)
  const innerPayload = {
    partner_id: String(UNPAY_PARTNER_ID),
    amount: String(amount),
    apitxnid: String(payload.apitxnid),
    webhook: String(webhook)
  }

  // 1️⃣ Stringify
  const jsonString = JSON.stringify(innerPayload)
  console.log("[UnPay QR] Raw JSON:", jsonString)

  // 2️⃣ Encrypt (AES-256-CBC → HEX → UPPERCASE)
  let encryptedHex: string
  try {
    encryptedHex = encryptAES256CBC(jsonString)
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