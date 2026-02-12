import axios from "axios"
import crypto from "crypto"
import net from "net"

// Config
import {
  UNPAY_PARTNER_ID,
  UNPAY_API_KEY,
  UNPAY_AES_KEY,
} from "../config/unpay"
import unpayClient from "../config/unpay"

// ======================
// AES Encrypt / Decrypt (STRICT UNPAY FORMAT)
// ======================

// ======================
// AES Encrypt (AES-128-ECB)
// ======================

function getAesKeyBuffer(): Buffer {
  if (!UNPAY_AES_KEY) {
    throw new Error("UNPAY_AES_KEY is missing")
  }
  // Use first 16 bytes for AES-128
  return Buffer.from(UNPAY_AES_KEY, "utf8").subarray(0, 16)
}

export function encryptAES(data: string): string {
  const key = getAesKeyBuffer()

  // AES-128-ECB does not use IV
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null)

  let encrypted = cipher.update(data, "utf8", "hex")
  encrypted += cipher.final("hex")

  return encrypted.toUpperCase() // Must be UPPERCASE
}

export function decryptAES(enc: string): string {
  const key = getAesKeyBuffer()

  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null)

  let decrypted = decipher.update(enc, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}


// ======================
// Clean IP (Helper)
// ======================

function cleanIp(ip?: string): string {
  if (!ip) return ""
  ip = ip.replace(/^::ffff:/, "")
  ip = ip.split(",")[0].trim()
  return ip
}

// ======================
// Create Pay-In Order (Existing)
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
// Create Dynamic QR (UPDATED)
// ======================

// ======================
// Create Dynamic QR (API-KEY IN HEADER ONLY)
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
  // 1. Create JSON Payload (NO EXTRA FIELDS)
  // ======================

  const innerPayload = {
    partner_id: Number(UNPAY_PARTNER_ID),
    apitxnid: payload.apitxnid,
    amount: amount,
    webhook,
    // ip_address REMOVED as per strict docs
  }

  const jsonString = JSON.stringify(innerPayload)

  // Log payload structure for debugging
  console.log(
    "[UnPay QR] Inner Payload (Plain):",
    JSON.stringify(innerPayload, null, 2)
  )

  // ======================
  // 2. Encrypt (AES-128-ECB, Hex, Uppercase)
  // ======================

  const encryptedString = encryptAES(jsonString)

  console.log("[UnPay QR] Encrypted Body (First 50 chars):", encryptedString.substring(0, 50) + "...")

  // ======================
  // 3. Send Request (STRICT FORMAT)
  // ======================

  const requestBody = {
    body: encryptedString
    // NO api_key here
  }


  console.log("[UnPay QR] Request Config Check:", {
    url: "/next/upi/request/qr",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "api-key": "PRESENT (Hidden)"
    },
    bodyKeys: Object.keys(requestBody)
  })

  try {
    const resp = await unpayClient.post(
      "/next/upi/request/qr",
      requestBody,
      {
        headers: {
          "api-key": UNPAY_API_KEY, // MANDATORY: api-key in HEADER
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      }
    )

    console.log("[UnPay QR] Response Status:", resp.status)

    if (resp.data?.statuscode !== "TXN") {
      console.error("[UnPay QR] Failed Response:", JSON.stringify(resp.data, null, 2))
      throw new Error(resp.data?.message || "QR Generation failed")
    }

    return {
      apitxnid: resp.data.data.apitxnid,
      qrString: resp.data.data.qrString,
      time: resp.data.data.time,
    }
  } catch (err: any) {
    console.error(
      "[UnPay QR] Error:",
      err.response?.data || err.message
    )

    throw new Error(err.response?.data?.message || "UnPay Dynamic QR failed")
  }
}
