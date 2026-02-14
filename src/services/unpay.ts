import axios from "axios"
import crypto from "crypto"
import net from "net"

// Config
import {
  UNPAY_PARTNER_ID,
  UNPAY_API_KEY,
  UNPAY_BASE_URL,
} from "../config/unpay"
import unpayClient from "../config/unpay"

// ======================
// AES Encrypt / Decrypt (STRICT UNPAY FORMAT: AES-256-ECB)
// ======================

function getAesKeyBuffer(): Buffer {
  const keyRaw = process.env.UNPAY_AES_KEY
  if (!keyRaw) {
    throw new Error("UNPAY_AES_KEY is missing in process.env")
  }

  const key = Buffer.from(keyRaw, "utf8")

  if (key.length !== 32) {
    throw new Error(`UNPAY_AES_KEY must be exactly 32 bytes (got ${key.length})`)
  }

  return key
}

export function encryptAES(data: string): string {
  const key = getAesKeyBuffer()
  const cipher = crypto.createCipheriv("aes-256-ecb", key, null)
  cipher.setAutoPadding(true)
  let encrypted = cipher.update(data, "utf8", "hex")
  encrypted += cipher.final("hex")
  return encrypted.toUpperCase()
}

export function decryptAES(enc: string): string {
  const key = getAesKeyBuffer()
  const decipher = crypto.createDecipheriv("aes-256-ecb", key, null)
  decipher.setAutoPadding(true)
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
// Get Server IP (IPv4 ONLY)
// ======================

export async function getUnpayIp(): Promise<string> {
  try {
    // Force fetching IPv4 from ipify
    const resp = await axios.get("https://api.ipify.org?format=json")

    let ip = cleanIp(resp.data.ip)

    if (!ip || net.isIP(ip) !== 4) {
      throw new Error(`Invalid IPv4 fetched: ${ip}`)
    }

    console.log(`[UnPay] Using IPv4: ${ip}`)
    return ip
  } catch (err: any) {
    console.error("[UnPay] Failed to fetch IPv4:", err.message)
    throw new Error("Unable to detect server IPv4")
  }
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
// Create Dynamic QR (STRICT AES-256-ECB & DIRECT AXIOS)
// ======================

export async function createUnpayDynamicQR(payload: {
  amount: number
  apitxnid: string
  webhook?: string
}) {
  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY || !UNPAY_BASE_URL) {
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
    partner_id: UNPAY_PARTNER_ID, // Send exactly as is via config
    apitxnid: payload.apitxnid,
    amount,
    webhook,
  }

  // ======================
  // 2. Encrypt (AES-256-ECB, Hex, Uppercase, AutoPadding)
  // ======================

  const encryptedString = encryptAES(JSON.stringify(innerPayload))

  // ======================
  // 3. Prepare Request Parts
  // ======================

  const endpoint = "/next/upi/request/qr"
  // Ensure base URL doesn't have trailing slash if endpoint has leading slash
  const baseUrl = UNPAY_BASE_URL.replace(/\/$/, "")
  const finalUrl = `${baseUrl}${endpoint}`

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "api-key": UNPAY_API_KEY
  }

  const bodyData = {
    body: encryptedString
  }

  // ======================
  // 4. Debug Log (STRICT FORMAT)
  // ======================

  console.log(`[UNPAY DEBUG]
URL: ${finalUrl}
Header Keys: ${Object.keys(headers).join(", ")}
Body Keys: ${Object.keys(bodyData).join(", ")}
Encrypted Length: ${encryptedString.length}`)

  // ======================
  // 5. Send Request (Direct Axios)
  // ======================

  try {
    const resp = await axios.post(finalUrl, bodyData, { headers })

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
