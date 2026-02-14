import axios from "axios"
import crypto from "crypto"

// Config
import {
  UNPAY_PARTNER_ID,
  UNPAY_API_KEY,
  UNPAY_BASE_URL,
} from "../config/unpay"
import unpayClient from "../config/unpay"

// ======================
// AES Encrypt / Decrypt (AES-128-ECB)
// ======================

function getAesKeyBuffer(): Buffer {
  const keyRaw = process.env.UNPAY_AES_KEY
  if (!keyRaw) {
    throw new Error("UNPAY_AES_KEY is missing in process.env")
  }

  // Detect if key is 32 chars hex (16 bytes) or raw 16 bytes
  if (keyRaw.length === 32 && /^[0-9a-fA-F]+$/.test(keyRaw)) {
    // It's a hex string representing 16 bytes
    return Buffer.from(keyRaw, "hex")
  }

  // Clean fallback (default utf8)
  const key = Buffer.from(keyRaw, "utf8")

  if (key.length >= 16) {
    return key.subarray(0, 16)
  }

  throw new Error(`UNPAY_AES_KEY must be at least 16 bytes (got ${key.length})`)
}

export function encryptAES(data: string): string {
  const key = getAesKeyBuffer()
  // AES-128-ECB, no IV, PKCS7 padding (default)
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null)
  cipher.setAutoPadding(true)
  let encrypted = cipher.update(data, "utf8", "base64")
  encrypted += cipher.final("base64")
  // Return Base64 directly
  return encrypted
}

export function decryptAES(enc: string): string {
  const key = getAesKeyBuffer()
  // AES-128-ECB, no IV, PKCS7 padding (default)
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null)
  decipher.setAutoPadding(true)
  let decrypted = decipher.update(enc, "base64", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

// ======================
// Create Pay-In Order (Existing - Using unpayClient)
// ======================

export async function createUnpayTransaction(payload: {
  amount: number
  metadata?: Record<string, any>
}) {
  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing")
  }

  const amount = Number(payload.amount)

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Invalid amount")
  }

  const orderId =
    payload.metadata?.order_id || `ANTBBPS${Date.now()}`

  const webhookUrl = process.env.UNPAY_WEBHOOK_URL

  if (!webhookUrl) {
    throw new Error("UNPAY_WEBHOOK_URL is not configured")
  }

  const body = {
    partner_id: UNPAY_PARTNER_ID,
    apitxnid: orderId,
    amount,
    webhook: webhookUrl,
  }

  try {
    const resp = await unpayClient.post(
      "/payin/order/create",
      body
    )

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


// ======================
// Create Dynamic QR (AES-128-ECB & Base64 Payload)
// ======================

export async function createUnpayDynamicQR(payload: {
  amount: number
  apitxnid: string
  webhook?: string
}) {
  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing")
  }

  const amount = Number(payload.amount)

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Invalid amount: must be a positive integer")
  }

  const webhook =
    payload.webhook || process.env.UNPAY_WEBHOOK_URL

  if (!webhook) {
    throw new Error("Webhook missing")
  }

  // ======================
  // 1. Create JSON Payload (Minimal)
  // ======================

  const innerPayload = {
    partner_id: parseInt(String(UNPAY_PARTNER_ID), 10), // User said "integer"
    apitxnid: payload.apitxnid,
    amount: amount,
    webhook: webhook
  }

  console.log("[UnPay QR] Inner Payload (Before Encryption):", JSON.stringify(innerPayload, null, 2))

  // ======================
  // 2. Encrypt (AES-128-ECB -> Base64)
  // ======================

  const encryptedString = encryptAES(JSON.stringify(innerPayload))

  // ======================
  // 3. Prepare Request
  // ======================

  // Using strict endpoint "https://unpay.in/tech/api" as per user request
  // Assuming full path is constructed appropriately. If UNPAY_BASE_URL is set, utilize it, else fallback.
  // User asked for "full axios POST example to: https://unpay.in/tech/api".
  // This likely implies: POST https://unpay.in/tech/api/next/upi/request/qr

  const baseUrl = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "")
  const finalUrl = `${baseUrl}/next/upi/request/qr`

  const headers = {
    "accept": "application/json",
    "api-key": UNPAY_API_KEY,
    "content-type": "application/json"
  }

  const bodyData = {
    encdata: encryptedString
  }

  // ======================
  // 4. Send Request (Direct Axios)
  // ======================

  try {
    console.log("[UnPay QR] Requesting:", finalUrl)

    const resp = await axios.post(finalUrl, bodyData, { headers })

    // Log raw response
    console.log("[UnPay QR] FULL RAW RESPONSE:", JSON.stringify(resp.data, null, 2))

    if (resp.data?.statuscode === "TXN") {
      // Extract qrString from success response
      // Expected format: resp.data.data.qrString | resp.data.qrString
      const qrString = resp.data?.data?.qrString || resp.data?.qrString;

      if (!qrString) {
        console.warn("[UnPay QR] Warning: 'TXN' status received but qrString missing in resp.data.data")
      }

      return {
        qrString: qrString || null,
        raw: resp.data
      }
    } else {
      throw new Error(resp.data?.message || "UnPay returned non-TXN status")
    }

  } catch (err: any) {
    console.error(
      "[UnPay QR] Error:",
      err.response?.data || err.message
    )
    throw new Error(err.response?.data?.message || "UnPay Dynamic QR failed")
  }
}