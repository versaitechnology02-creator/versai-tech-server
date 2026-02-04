import axios from "axios"
import crypto from "crypto"
import net from "net"
import dns from "dns"
import http from "http"
import https from "https"

// Config import
import {
  UNPAY_PARTNER_ID,
  UNPAY_API_KEY,
  UNPAY_AES_KEY,
  UNPAY_IV,
  UNPAY_BASE_URL,
} from "../config/unpay"

// ======================
// DNS Lookup for IPv4
// ======================
const lookup4 = (
  hostname: string,
  options: any,
  callback?: (err: NodeJS.ErrnoException | null, address: string) => void
) => {
  if (typeof options === "function") {
    return dns.lookup(hostname, { family: 4 }, options)
  }
  return dns.lookup(hostname, { family: 4 }, callback as any)
}

const httpAgent = new http.Agent({ lookup: lookup4 })
const httpsAgent = new https.Agent({ lookup: lookup4 })

// ======================
// Axios client
// ======================
const unpayClient = axios.create({
  baseURL: UNPAY_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "api-key": UNPAY_API_KEY,
  },
  httpAgent,
  httpsAgent,
})

// ======================
// AES Encryption / Decryption
// ======================
function validateAesConfig() {
  if (!UNPAY_AES_KEY || UNPAY_AES_KEY.length !== 32) {
    throw new Error("UNPAY_AES_KEY must be exactly 32 characters")
  }
  if (!UNPAY_IV || UNPAY_IV.length !== 16) {
    throw new Error("UNPAY_IV must be exactly 16 characters")
  }
}

export function encryptAES(data: string): string {
  validateAesConfig()

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(UNPAY_IV, "utf8")
  )

  let encrypted = cipher.update(data, "utf8", "hex")
  encrypted += cipher.final("hex")
  return encrypted
}

export function decryptAES(encryptedData: string): string {
  validateAesConfig()

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(UNPAY_AES_KEY, "utf8"),
    Buffer.from(UNPAY_IV, "utf8")
  )

  let decrypted = decipher.update(encryptedData, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

// ======================
// Clean IP Utility
// ======================
function cleanIp(ip: string | undefined): string {
  if (!ip) return ''
  // Remove ::ffff: prefix for IPv4 mapped to IPv6
  ip = ip.replace(/^::ffff:/, '')
  // Take first IP if comma-separated
  ip = ip.split(',')[0].trim()
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
      console.log("[UnPay] Using IP from env:", ip)
      return ip
    }
  }

  // Fallback to fetch public IP
  try {
    console.log("[UnPay] Fetching server public IP...")
    const resp = await axios.get('https://api.ipify.org?format=json')
    ip = resp.data.ip
    ip = cleanIp(ip)
    if (!ip || net.isIP(ip) !== 4) {
      throw new Error("Invalid IP fetched")
    }
    console.log("[UnPay] Using fetched IP:", ip)
    return ip
  } catch (err: any) {
    console.error("[UnPay] Get IP error (FULL):", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    })
    throw new Error("Unable to determine valid server IP")
  }
}

// ======================
// Create Pay-In Transaction
// ======================
export async function createUnpayTransaction(payload: {
  amount: number
  currency?: string
  description?: string
  customer?: { name?: string; email?: string; phone?: string }
  metadata?: Record<string, any>
  client_ip?: string
}) {
  console.log("[UnPay] Creating transaction with payload:", payload)

  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing in environment variables")
  }

  const amount = Number(payload.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a positive integer (rupees)")
  }

  // Use correct UnPay order creation endpoint and parameters as per latest docs/support
  const orderId =
    payload.metadata?.razorpay_order_id ||
    payload.metadata?.order_id ||
    `ANTBBPS${Date.now()}`;

  const webhookUrl = process.env.UNPAY_WEBHOOK_URL || process.env.UNPAY_CALLBACK_URL || process.env.SERVER_URL || "https://payments.versaitechnology.com/api/payments/webhook/unpay";

  // Build parameter object as per support message and docs
  const requestBody: any = {
    partner_id: UNPAY_PARTNER_ID,
    apitxnid: orderId,
    amount: amount,
    webhook: webhookUrl,
  };

  console.log("[UnPay] Request body (for /payin/order/create):", JSON.stringify(requestBody, null, 2));

  // Always send as JSON (no encryption for this endpoint)
  try {
    const resp = await unpayClient.post("/payin/order/create", requestBody);

    console.log("[UnPay] Create payment response:", JSON.stringify(resp.data, null, 2));

    const data = resp.data;
    if (data.statuscode !== "TXN") {
      throw new Error(data.message || "UnPay order creation failed");
    }

    return {
      raw: data,
      order_id: orderId,
      transaction_id: data.upi_tr || data.txnid,
      upi_reference: data.upi_tr,
      upi_intent: data.upi_string,
      payment_url: data.upi_string || data.upi_intent || data.payment_link,
    };
  } catch (err: any) {
    console.error("[UnPay] Create payment error (FULL):", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    });
    throw new Error(
      err.response?.data?.message ||
        err.response?.data?.error ||
        "UnPay transaction failed"
    );
  }
}

// ======================
// Create Dynamic QR
// ======================
export async function createUnpayDynamicQR(payload: {
  amount: number
  apitxnid: string
  customer_email?: string
  currency?: string
  webhook?: string
}) {
  console.log("[UnPay Dynamic QR] Payload:", payload)

  if (!UNPAY_PARTNER_ID || !UNPAY_API_KEY) {
    throw new Error("UnPay credentials missing in environment variables")
  }

  const amount = Number(payload.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a positive integer (INR)")
  }

  // Use provided webhook or default
  const webhookUrl = payload.webhook || process.env.UNPAY_WEBHOOK_URL
  if (!webhookUrl) {
    throw new Error("Webhook URL is required")
  }

  // ======================================================
  // Determine gateway mode (LIVE vs TEST)
  // LIVE must never encrypt payloads
  // ======================================================
  const isLiveEnv =
    process.env.UNPAY_ENV === "live" ||
    process.env.NODE_ENV === "production" ||
    (!!process.env.SERVER_URL && process.env.SERVER_URL.includes("versaitechnology.com"))

  const requestBody: any = {
    partner_id: UNPAY_PARTNER_ID,
    apitxnid: payload.apitxnid,
    amount: amount.toString(),
    webhook: webhookUrl,
  }

  // Add IP for whitelisting
  try {
    const ip = await getUnpayIp()
    requestBody.ip = ip
    console.log("[UnPay] Using IP:", ip)
  } catch (err) {
    console.warn("[UnPay] Failed to get IP, proceeding without:", err.message)
  }
    

  console.log("[PAYMENT GATEWAY MODE] [UnPay Dynamic QR]", {
    mode: isLiveEnv ? "live" : "test",
    NODE_ENV: process.env.NODE_ENV,
    UNPAY_ENV: process.env.UNPAY_ENV,
    SERVER_URL: process.env.SERVER_URL,
  })

  const encryptionEnabled = true // Always encrypt for UnPay API

  console.log("[PAYMENT ENCRYPTION STATUS] [UnPay Dynamic QR]", {
    encryptionEnabled,
  })

  console.log(
    "[UnPay Dynamic QR] Request body before encryption:",
    JSON.stringify(requestBody, null, 2)
  )

  let bodyToSend: any
  if (encryptionEnabled) {
    // Encrypt the body for test mode
    const encryptedBody = encryptAES(JSON.stringify(requestBody))
    bodyToSend = JSON.stringify({ body: encryptedBody })
    console.log("[UnPay Dynamic QR] Encrypted request body:", bodyToSend)
  } else {
    // Send plain JSON for live mode
    bodyToSend = requestBody
    console.log("[UnPay Dynamic QR] Plain request body:", JSON.stringify(bodyToSend, null, 2))
  }

  try {
    const resp = await unpayClient.post("/next/upi/request/qr", bodyToSend)

    console.log(
      "[UnPay Dynamic QR] Response:",
      JSON.stringify(resp.data, null, 2)
    );

    if (resp.data?.status !== "TXN") {
      throw new Error(resp.data?.message || "UnPay Dynamic QR creation failed");
    }

    return {
      apitxnid: resp.data.data.apitxnid,
      qrString: resp.data.data.qrString,
      time: resp.data.data.time,
    };
  } catch (err: any) {
    console.error("[UnPay Dynamic QR] Error (FULL):", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    });

    throw new Error(
      err.response?.data?.message ||
        err.response?.data?.error ||
        "UnPay Dynamic QR failed"
    );
  }
}
