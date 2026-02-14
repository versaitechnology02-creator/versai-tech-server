import axios from "axios"
import crypto from "crypto"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (FINAL)
// ==========================================

// 1. Strict AES Key Buffer (Forced AES-128)
function getAesKeyBuffer(): Buffer {
  const keyRaw = process.env.UNPAY_AES_KEY || ""

  if (!keyRaw) {
    throw new Error("UNPAY_AES_KEY is missing")
  }

  // FORCE TRUNCATION TO 16 CHARS (AES-128)
  // UnPay often provides a 32-char string but expects AES-128 using the first 16 chars.
  const keyPart = keyRaw.substring(0, 16)

  // Use UTF-8 parsing for the key
  return Buffer.from(keyPart, "utf8")
}

// 2. Encrypt Function (AES-ECB, PKCS7, Base64 Output, NO IV)
export function encryptAES(data: string): string {
  const key = getAesKeyBuffer()

  // FORCE AES-128-ECB
  const algo = "aes-128-ecb"

  if (key.length !== 16) {
    throw new Error(`Invalid AES Key length for AES-128: ${key.length}. Must be 16 bytes.`)
  }

  console.log(`[UnPay Security] Using Encryption: ${algo}, Key Length: ${key.length} bytes`)

  const cipher = crypto.createCipheriv(algo, key, null)
  cipher.setAutoPadding(true)
  let encrypted = cipher.update(data, "utf8", "base64")
  encrypted += cipher.final("base64")
  return encrypted
}

export function decryptAES(enc: string): string {
  const key = getAesKeyBuffer()
  const algo = "aes-128-ecb"

  const decipher = crypto.createDecipheriv(algo, key, null)
  decipher.setAutoPadding(true)
  let decrypted = decipher.update(enc, "base64", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

// ======================
// Create Dynamic QR (PRODUCTION)
// ======================

export async function createUnpayDynamicQR(payload: {
  amount: number
  apitxnid: string
  webhook?: string
}) {
  console.log("[UnPay QR] Starting Strict Creation Process...")

  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing (Partner ID or API Key)")
  }

  const amount = Number(payload.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}. Must be positive integer.`)
  }

  const webhook = payload.webhook || process.env.UNPAY_WEBHOOK_URL
  if (!webhook) {
    console.error("[UnPay QR] CRITICAL: UNPAY_WEBHOOK_URL is missing in environment variables")
    throw new Error("Webhook URL is configured. Check UNPAY_WEBHOOK_URL in .env")
  }

  const innerPayload = {
    partner_id: parseInt(String(UNPAY_PARTNER_ID), 10),
    apitxnid: payload.apitxnid,
    amount: amount,
    webhook: webhook
  }

  // Minified JSON logging for debug
  const jsonPayload = JSON.stringify(innerPayload)
  console.log("[UnPay QR] Inner Payload (Minified):", jsonPayload)

  let encryptedString: string
  try {
    encryptedString = encryptAES(jsonPayload)
    console.log(`[UnPay QR] Encryption Success. Output Length: ${encryptedString.length}`)
  } catch (err: any) {
    console.error("[UnPay QR] Encryption Failed:", err.message)
    throw err
  }

  // CORRECT ENDPOINT: https://unpay.in/tech/api/next/upi/request/qr
  const envBaseUrl = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "")
  const finalUrl = `${envBaseUrl}/next/upi/request/qr`

  const requestBody = {
    encdata: encryptedString
  }

  try {
    console.log(`[UnPay QR] Sending Request to: ${finalUrl}`)

    // Header Strategy: Send BOTH common formats to be safe
    // Also include Authorization: 'Bearer ...' just in case? No, api-key is standard.
    const headers = {
      "Content-Type": "application/json",
      "api-key": UNPAY_API_KEY.trim()
    }

    const resp = await axios.post(finalUrl, requestBody, {
      headers: headers,
      timeout: 15000
    })

    console.log("[UnPay QR] Response Status:", resp.status)

    if (resp.data && resp.data.statuscode === "TXN") {
      const qrString = resp.data.data?.qrString || resp.data.qrString

      if (!qrString) {
        console.warn("[UnPay QR] Success status (TXN) but qrString missing!")
      }

      return {
        qrString: qrString || null,
        raw: resp.data
      }
    } else {
      const errMsg = resp.data?.message || "Unknown UnPay Error"
      console.error(`[UnPay QR] API Error: ${errMsg}`, JSON.stringify(resp.data))
      throw new Error(errMsg)
    }

  } catch (err: any) {
    if (err.response) {
      console.error("[UnPay QR] HTTP Error:", err.response.status, JSON.stringify(err.response.data))
      throw new Error(err.response.data?.message || `UnPay HTTP ${err.response.status} - ${JSON.stringify(err.response.data)}`)
    } else {
      console.error("[UnPay QR] Network/Code Error:", err.message)
      throw new Error(err.message || "UnPay Request Failed")
    }
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
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid amount")

  const orderId = payload.metadata?.order_id || `ANTBBPS${Date.now()}`
  const webhookUrl = process.env.UNPAY_WEBHOOK_URL
  if (!webhookUrl) throw new Error("UNPAY_WEBHOOK_URL missing")

  const body = {
    partner_id: UNPAY_PARTNER_ID,
    apitxnid: orderId,
    amount,
    webhook: webhookUrl,
  }

  try {
    const resp = await unpayClient.post("/payin/order/create", body)
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
    console.error("[UnPay] Order Error:", err.response?.data || err.message)
    throw new Error("UnPay order creation failed")
  }
}