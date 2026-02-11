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

function validateAesConfig() {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length !== 32) {
    throw new Error("UNPAY_AES_KEY must be exactly 32 characters")
  }
}

export function encryptAES(data: string): string {
  validateAesConfig()

  // IV derived from first 16 chars of key
  const iv = UNPAY_AES_KEY.substring(0, 16)

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(iv, "utf8")
  )

  let encrypted = cipher.update(data, "utf8", "hex")
  encrypted += cipher.final("hex")

  return encrypted
}

export function decryptAES(enc: string): string {
  validateAesConfig()

  const iv = UNPAY_AES_KEY.substring(0, 16)

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(iv, "utf8")
  )

  let decrypted = decipher.update(enc, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}

// ======================
// Clean IP
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
// Create Pay-In Order
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
// Create Dynamic QR
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
    throw new Error("Invalid amount")
  }

  const webhook =
    payload.webhook || process.env.UNPAY_WEBHOOK_URL

  if (!webhook) {
    throw new Error("Webhook missing")
  }

  // 1. Fetch Server IP (IPv4)
  const ip = await getUnpayIp()

  // ======================
  // Build Inner Payload
  // ======================

  const innerPayload = {
    partner_id: Number(UNPAY_PARTNER_ID),
    apitxnid: payload.apitxnid,
    amount: amount,
    webhook,
    ip_address: ip // INJECT IP HERE
  }

  console.log(
    "[UnPay QR] Inner Payload (Pre-Encryption):",
    JSON.stringify(innerPayload, null, 2)
  )

  // ======================
  // Encrypt (HEX FORMAT)
  // ======================

  const encryptedString = encryptAES(
    JSON.stringify(innerPayload)
  )

  const requestBody = {
    body: encryptedString,
  }

  console.log(
    "[UnPay QR] Final Request Body (Encrypted HEX):",
    JSON.stringify(requestBody, null, 2)
  )

  // ======================
  // Send Request
  // ======================

  try {
    const resp = await unpayClient.post(
      "/next/upi/request/qr",
      requestBody
    )

    console.log("[UnPay QR] Response:", resp.data)

    if (resp.data?.status !== "TXN") {
      throw new Error(resp.data?.message || "QR failed")
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

    throw new Error("UnPay Dynamic QR failed")
  }
}
