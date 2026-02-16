import axios from "axios"
import https from "https"
import crypto from "crypto"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY, UNPAY_AES_KEY } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (AES-128-ECB)
// ==========================================

// Create HTTPS Agent to force IPv4
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
})

// ======================
// ENCRYPTION HELPER
// ======================

function encryptAES128(text: string): string {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length < 16) {
    throw new Error(`Invalid AES Key length: ${UNPAY_AES_KEY?.length}. Must be at least 16 chars.`)
  }

  // 1. Key: First 16 bytes
  const key = Buffer.from(UNPAY_AES_KEY.substring(0, 16), "utf8")

  // 2. Algorithm: aes-128-ecb
  const algorithm = "aes-128-ecb"

  // 3. Create Cipher (Auto Padding = PKCS7)
  const cipher = crypto.createCipheriv(algorithm, key, null)
  cipher.setAutoPadding(true)

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
  console.log("[UnPay QR] Starting Creation Process (AES-128-ECB)...")

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

  // 1. Raw JSON Payload
  // partner_id: Number (4358)
  const innerPayload = {
    partner_id: String(UNPAY_PARTNER_ID),
    amount: String(amount),
    apitxnid: String(apitxnid),
    webhook: String(webhook)
  }

  // 2. Stringify
  const jsonString = JSON.stringify(innerPayload)
  console.log("[UnPay QR] Raw JSON:", jsonString)

  // 3. Encrypt
  let encryptedHex: string
  try {
    encryptedHex = encryptAES128(jsonString)
    console.log(`[UnPay QR] Encrypted HEX (Len: ${encryptedHex.length}):`, encryptedHex.substring(0, 50) + "...")
  } catch (err: any) {
    console.error("[UnPay QR] Encryption Failed:", err.message)
    throw err
  }

  // 4. Wrap
  const requestBody = {
    body: encryptedHex
  }
  console.log("[UnPay QR] Final Request Body:", JSON.stringify(requestBody))

  // 5. Send Request
  const envBaseUrl = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "")
  const finalUrl = `${envBaseUrl}/next/upi/request/qr`

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
    // console.log("[UnPay QR] Response Data:", JSON.stringify(resp.data))

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