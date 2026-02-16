import axios from "axios"
import crypto from "crypto"
import https from "https"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (CORRECTED)
// ==========================================

// Create HTTPS Agent to force IPv4
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
})

// 1. Strict AES Key Buffer (AES-256)
function getAesKeyBuffer(): Buffer {
  const keyRaw = process.env.UNPAY_AES_KEY || ""

  // STRICT VALIDATION: Must be exactly 32 chars for AES-256
  if (keyRaw.length !== 32) {
    throw new Error(`UNPAY_AES_KEY Invalid Length: ${keyRaw.length}. Must be exactly 32 bytes.`)
  }

  // Use UTF-8 parsing for the key
  return Buffer.from(keyRaw, "utf8")
}

// 2. Encrypt Function (AES-256-ECB, PKCS7, Hex Output, NO IV)
export function encryptAES(data: string): string {
  const key = getAesKeyBuffer()
  const algo = "aes-256-ecb"

  console.log(`[UnPay Security] Algo: ${algo}, Key Length: ${key.length} bytes`)

  const cipher = crypto.createCipheriv(algo, key, null)
  cipher.setAutoPadding(true)

  // Update: Input=utf8, Output=hex
  let encrypted = cipher.update(data, "utf8", "hex")
  encrypted += cipher.final("hex")

  // Force Uppercase
  return encrypted.toUpperCase()
}

export function decryptAES(enc: string): string {
  const key = getAesKeyBuffer()
  const algo = "aes-256-ecb"

  const decipher = crypto.createDecipheriv(algo, key, null)
  decipher.setAutoPadding(true)

  // Update: Input=hex, Output=utf8
  let decrypted = decipher.update(enc, "hex", "utf8")
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
  console.log("[UnPay QR] Starting Creation Process...")

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

  // INNER PAYLOAD: Strict Types
  const innerPayload = {
    partner_id: Number(UNPAY_PARTNER_ID), // Ensure Number
    apitxnid: String(payload.apitxnid),
    amount: amount,                       // Ensure Number
    webhook: String(webhook)
  }

  const jsonPayload = JSON.stringify(innerPayload)
  console.log("[UnPay QR] Inner Payload:", jsonPayload)

  let encryptedString: string
  try {
    encryptedString = encryptAES(jsonPayload)

    // VALIDATE HEX
    if (!/^[0-9A-F]+$/.test(encryptedString)) {
      throw new Error("Encryption output is NOT valid HTTP Hex")
    }

    console.log(`[UnPay QR] Encryption Success. Output Length: ${encryptedString.length}`)
    console.log(`[UnPay QR] Output Preview: ${encryptedString.substring(0, 20)}...`)

  } catch (err: any) {
    console.error("[UnPay QR] Encryption Failed:", err.message)
    throw err
  }

  // CORRECT ENDPOINT
  const envBaseUrl = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "")
  const finalUrl = `${envBaseUrl}/next/upi/request/qr`

  // FINAL WRAPPER: { body: ... }
  const requestBody = {
    body: encryptedString
  }

  console.log("[UnPay QR] Final Request Body Wrapper Key: body")

  try {
    console.log(`[UnPay QR] Sending Request to: ${finalUrl}`)

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "api-key": UNPAY_API_KEY.trim()
    }

    const resp = await axios.post(finalUrl, requestBody, {
      headers: headers,
      timeout: 15000,
      httpsAgent: httpsAgent, // Force IPv4
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
  // Legacy function - kept for completeness
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