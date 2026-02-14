import axios from "axios"
import crypto from "crypto"

// Config
import {
  UNPAY_PARTNER_ID,
  UNPAY_API_KEY,
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

  let key: Buffer

  // 1. Try parsing as 32-char Hex (16 bytes)
  if (keyRaw.length === 32 && /^[0-9a-fA-F]+$/.test(keyRaw)) {
    key = Buffer.from(keyRaw, "hex")
    if (key.length !== 16) {
      // Fallback if hex parsing somehow failed to produce 16 bytes (unlikely with regex check)
      throw new Error(`Invalid Hex key length: ${key.length}`)
    }
  }
  // 2. Treat as 16-char UTF-8 string
  else if (keyRaw.length === 16) {
    key = Buffer.from(keyRaw, "utf8")
  }
  // 3. Last ditch effort: if it's longer/shorter but we need 16 bytes for AES-128
  else {
    // Try to use it as utf8 and slice/pad? No, strict mode requested.
    // But user said "Key supports: 32 hex string -> convert... 16 char string -> use utf8"
    throw new Error(`UNPAY_AES_KEY invalid format. Must be 32-char HEX or 16-char UTF-8. Got length: ${keyRaw.length}`)
  }

  console.log(`[UnPay Security] AES Key loaded. Length: ${key.length} bytes`)
  return key
}

export function encryptAES(data: string): string {
  const key = getAesKeyBuffer()

  // AES-128-ECB, no IV, PKCS7 padding (default)
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null)
  cipher.setAutoPadding(true)

  // Output MUST be BASE64
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
// Create Dynamic QR (Strict AES-128-ECB & Base64 Payload)
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
  console.log(`[UnPay Security] Encrypted Payload Length: ${encryptedString.length}`)

  // ======================
  // 3. Prepare Request
  // ======================

  const finalUrl = "https://unpay.in/tech/api/next/upi/request/qr"

  const headers = {
    "api-key": UNPAY_API_KEY,
    "Content-Type": "application/json"
  }

  const bodyData = {
    encdata: encryptedString
  }

  // ======================
  // 4. Send Request (Direct Axios)
  // ======================

  try {
    console.log("[UnPay QR] Requesting:", finalUrl)

    // Explicitly disabling serialization issues by sending plain object (axios handles JSON)
    const resp = await axios.post(finalUrl, bodyData, {
      headers: headers,
      timeout: 10000
    })

    // Log raw response
    console.log("[UnPay QR] FULL RAW RESPONSE:", JSON.stringify(resp.data, null, 2))

    if (resp.data?.statuscode === "TXN") {
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