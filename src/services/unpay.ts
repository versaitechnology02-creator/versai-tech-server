import axios from "axios"
import https from "https"
import crypto from "crypto"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY, UNPAY_AES_KEY } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (AES-256-ECB)
// ==========================================

// Create HTTPS Agent to force IPv4
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
})

// ======================
// ENCRYPTION HELPER (AES-256-ECB + ZERO PADDING)
// ======================

function padZero(text: string): Buffer {
  const blockSize = 16
  const buffer = Buffer.from(text, "utf8")
  const paddingLen = blockSize - (buffer.length % blockSize)

  if (paddingLen === 0 && buffer.length > 0) {
    return buffer
  }

  // Create padding buffer of zeros
  const padding = Buffer.alloc(paddingLen === 16 ? 0 : paddingLen, 0) // Standard zero padding: if aligned, add nothing? 
  // Wait, standard Zero padding usually pads to next block if not aligned, or does nothing if aligned. 
  // BUT PKCS7 always adds. "No padding" usually means literal "No Padding" (crash if not aligned) OR "Zero Padding".
  // Let's implement rigorous Zero Padding: Pad with \0 to reach multiple of 16.

  // Re-eval: If client says "No padding", and input is JSON (variable length), we MUST pad to 16 manually.
  // Common legacy behavior: Pad with \0 up to next block.

  const targetLength = buffer.length + (paddingLen === 16 ? 0 : paddingLen)
  const padded = Buffer.concat([buffer, Buffer.alloc(targetLength - buffer.length, 0)])
  return padded
}

function encryptAES256(text: string): string {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length !== 32) {
    throw new Error(`Invalid AES Key length: ${UNPAY_AES_KEY?.length}. Must be strictly 32 chars for AES-256.`)
  }

  // 1. Key: Full 32 bytes
  const key = Buffer.from(UNPAY_AES_KEY, "utf8")

  // 2. Algorithm: aes-256-ecb
  const algorithm = "aes-256-ecb"

  // 3. Create Cipher (No Auto Padding)
  const cipher = crypto.createCipheriv(algorithm, key, null)
  cipher.setAutoPadding(false) // ⚠️ CLIENT REQUESTED "No padding needed" -> We handle it manually.

  // 4. Encrypt with Zero Padding
  const paddedInput = padZero(text)
  let encrypted = cipher.update(paddedInput).toString("hex")
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
  console.log("[UnPay QR] Starting Creation Process (AES-256-ECB STRICT)...")

  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing (Partner ID or API Key)")
  }

  const amount = Number(payload.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}. Must be positive integer.`)
  }

  const webhook =
    payload.webhook || process.env.UNPAY_WEBHOOK_URL

  if (!webhook) {
    throw new Error("Webhook URL missing. Set UNPAY_WEBHOOK_URL in environment.")
  }

  // ✅ FINAL INNER PAYLOAD (ALL STRINGS)
  const innerPayload = {
    partner_id: String(UNPAY_PARTNER_ID),
    amount: String(amount),
    apitxnid: String(payload.apitxnid),
    webhook: String(webhook)
  }

  // 1️⃣ Stringify
  const jsonString = JSON.stringify(innerPayload)
  console.log("[UnPay QR] Raw JSON:", jsonString)

  // 2️⃣ Encrypt (AES-256-ECB → ZERO PAD → HEX → UPPERCASE)
  let encryptedHex: string
  try {
    encryptedHex = encryptAES256(jsonString)
    console.log(
      `[UnPay QR] Encrypted HEX (Len: ${encryptedHex.length}):`,
      encryptedHex.substring(0, 50) + "..."
    )
  } catch (err: any) {
    console.error("[UnPay QR] Encryption Failed:", err.message)
    throw err
  }

  // 3️⃣ Wrap Body
  const requestBody = {
    body: encryptedHex
  }

  console.log("[UnPay QR] Final Request Body:", JSON.stringify(requestBody))

  // 4️⃣ Final URL
  const baseUrl = (process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api").replace(/\/$/, "")
  const finalUrl = `${baseUrl}/next/upi/request/qr`

  console.log("[UnPay QR] Sending Request to:", finalUrl)

  try {
    const response = await axios.post(
      finalUrl,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "api-key": UNPAY_API_KEY.trim()
        },
        timeout: 15000,
        httpsAgent: httpsAgent
      }
    )

    console.log("[UnPay QR] Response Status:", response.status)
    console.log("[UnPay QR] Response Data:", JSON.stringify(response.data))

    if (response.data?.statuscode !== "TXN") {
      throw new Error(response.data?.message || "UnPay returned error")
    }

    return response.data

  } catch (error: any) {
    console.error(
      "[UnPay QR] API Error:",
      error.response?.data || error.message
    )
    throw new Error(
      error.response?.data?.message || error.message
    )
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