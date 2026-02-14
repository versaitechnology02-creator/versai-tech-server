import axios from "axios"
import crypto from "crypto"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (FINAL)
// ==========================================

// 1. Strict AES Key Buffer (MUST BE 16 BYTES)
function getAesKeyBuffer(): Buffer {
  // Use env directly to avoid stale config
  const keyRaw = process.env.UNPAY_AES_KEY || ""

  if (!keyRaw) {
    throw new Error("UNPAY_AES_KEY is missing")
  }

  let key: Buffer

  // CASE A: 32-char Hex String -> Convert to 16 bytes
  if (keyRaw.length === 32 && /^[0-9a-fA-F]+$/.test(keyRaw)) {
    key = Buffer.from(keyRaw, "hex")
  }
  // CASE B: 16-char UTF-8 String -> Use directly
  else if (keyRaw.length === 16) {
    key = Buffer.from(keyRaw, "utf8")
  }
  // CASE C: Invalid Format
  else {
    console.error(`[UnPay Security] Invalid Key Length: ${keyRaw.length}`)
    throw new Error(`UNPAY_AES_KEY invalid. Must be 32 HEX chars or 16 UTF-8 chars.`)
  }

  if (key.length !== 16) {
    throw new Error(`[UnPay Security] Derived key is ${key.length} bytes. Required: 16 bytes.`)
  }

  return key
}

// 2. Encrypt Function (AES-128-ECB, PKCS7, Base64 Output, NO IV)
export function encryptAES(data: string): string {
  const key = getAesKeyBuffer()
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null)
  cipher.setAutoPadding(true)
  let encrypted = cipher.update(data, "utf8", "base64")
  encrypted += cipher.final("base64")
  return encrypted
}

export function decryptAES(enc: string): string {
  const key = getAesKeyBuffer()
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null)
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
    throw new Error("Webhook URL is missing.")
  }

  // D. Construct Inner Payload
  // STRICT: partner_id must be integer, no extra fields
  const innerPayload = {
    partner_id: parseInt(String(UNPAY_PARTNER_ID), 10),
    apitxnid: payload.apitxnid,
    amount: amount,
    webhook: webhook
  }

  console.log("[UnPay QR] Inner Payload:", JSON.stringify(innerPayload, null, 2))

  // E. Encrypt Payload
  let encryptedString: string
  try {
    encryptedString = encryptAES(JSON.stringify(innerPayload))
    console.log(`[UnPay QR] Encryption Success. Output Length: ${encryptedString.length}`)
  } catch (err: any) {
    console.error("[UnPay QR] Encryption Failed:", err.message)
    throw err
  }

  // F. Prepare Request
  // CORRECT ENDPOINT: https://unpay.in/tech/api/next/upi/request/qr
  // Ensuring no double slashes and correct base

  const envBaseUrl = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "")
  const finalUrl = `${envBaseUrl}/next/upi/request/qr`

  // Outer Body: { encdata: "..." }
  // This is the CRITICAL part for "Invalid encryption request or body value missing"
  const requestBody = {
    encdata: encryptedString
  }

  // G. Execute Request
  try {
    console.log(`[UnPay QR] Sending Request to: ${finalUrl}`)

    // Header Strategy: Send BOTH common formats to be safe if docs are ambiguous
    // but typically it is 'api-key'. We will send 'api-key' as primary.
    // Ensure content-type is strictly application/json

    const headers = {
      "Content-Type": "application/json",
      "api-key": UNPAY_API_KEY.trim()
    }

    const resp = await axios.post(finalUrl, requestBody, {
      headers: headers,
      timeout: 15000
    })

    console.log("[UnPay QR] Response Status:", resp.status)

    // H. Handle Response
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
      console.error(`[UnPay QR] API Error: ${errMsg}`)
      throw new Error(errMsg)
    }

  } catch (err: any) {
    if (err.response) {
      console.error("[UnPay QR] HTTP Error:", err.response.status, err.response.data)
      throw new Error(err.response.data?.message || `UnPay HTTP ${err.response.status}`)
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