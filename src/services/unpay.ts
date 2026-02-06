import axios from "axios"
import crypto from "crypto"
import net from "net"

// Config
import {
  UNPAY_PARTNER_ID,
  UNPAY_API_KEY,
  UNPAY_AES_KEY,
  UNPAY_IV,
  UNPAY_BASE_URL,
} from "../config/unpay"
import unpayClient from "../config/unpay"

// ======================
// AES Validation
// ======================
function validateAesConfig() {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length !== 32) {
    throw new Error("UNPAY_AES_KEY must be exactly 32 characters")
  }

  if (!UNPAY_IV || UNPAY_IV.length !== 16) {
    throw new Error("UNPAY_IV must be exactly 16 characters")
  }
}

// ======================
// AES Encrypt / Decrypt
// ======================
export function encryptAES(data: string): string {
  validateAesConfig()

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(UNPAY_IV, "utf8")
  )

  let encrypted = cipher.update(data, "utf8", "base64")
  encrypted += cipher.final("base64")

  return encrypted
}

export function decryptAES(enc: string): string {
  validateAesConfig()

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(UNPAY_IV, "utf8")
  )

  let decrypted = decipher.update(enc, "base64", "utf8")
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
// Get Server IP
// ======================
export async function getUnpayIp(): Promise<string> {
  let ip = process.env.SERVER_PUBLIC_IP

  if (ip) {
    ip = cleanIp(ip)

    if (net.isIP(ip) === 4) {
      console.log("[UnPay] Using ENV IP:", ip)
      return ip
    }
  }

  try {
    console.log("[UnPay] Fetching public IP...")

    const resp = await axios.get("https://api.ipify.org?format=json")

    ip = cleanIp(resp.data.ip)

    if (!ip || net.isIP(ip) !== 4) {
      throw new Error("Invalid IP fetched")
    }

    console.log("[UnPay] Using fetched IP:", ip)

    return ip
  } catch (err: any) {
    console.error("[UnPay] IP fetch failed:", err.message)
    throw new Error("Unable to detect server IP")
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

  const webhookUrl =
    process.env.UNPAY_WEBHOOK_URL ||
    "https://api.versaitechnology.com/api/payments/webhook/unpay"

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
  customer_email?: string
  currency?: string
}) {
  console.log("[UnPay QR] Payload:", payload)

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

  // ======================
  // Build Base Payload
  // ======================
  const basePayload: any = {
    partner_id: UNPAY_PARTNER_ID,
    apitxnid: payload.apitxnid,
    amount: amount.toString(),
    webhook,
    customer_email: payload.customer_email,
  }

  // Add IP
  try {
    const ip = await getUnpayIp()
    basePayload.ip = ip
  } catch {
    console.warn("[UnPay] IP not attached")
  }

  console.log("[UnPay QR] Raw Payload:", basePayload)

  // ======================
  // ALWAYS Encrypt (TEST + LIVE)
  // ======================
  const encrypted = encryptAES(
    JSON.stringify(basePayload)
  )

  const finalBody = {
    partner_id: UNPAY_PARTNER_ID,
    request: encrypted,
  }

  console.log("[UnPay QR] Encrypted Payload Ready")

  // ======================
  // Send Request
  // ======================
  try {
    const resp = await unpayClient.post(
      "/next/upi/request/qr",
      finalBody
    )

    console.log("[UnPay QR] Response:", resp.data)

    if (resp.data?.status !== "TXN") {
      throw new Error(
        resp.data?.message || "QR failed"
      )
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
