import axios from "axios"
import https from "https"
import { UNPAY_PARTNER_ID, UNPAY_API_KEY } from "../config/unpay"
import unpayClient from "../config/unpay"

// ==========================================
// UNPAY DYNAMIC QR INTEGRATION (PLAIN JSON)
// ==========================================

// Create HTTPS Agent to force IPv4
const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
})

// ======================
// Create Dynamic QR (PRODUCTION)
// ======================

export async function createUnpayDynamicQR(payload: {
  amount: number
  apitxnid: string
  webhook?: string
}) {
  console.log("[UnPay QR] Starting Creation Process (PLAIN JSON)...")

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

  // PLAIN PAYLOAD
  const requestBody = {
    partner_id: Number(UNPAY_PARTNER_ID),
    apitxnid: String(payload.apitxnid),
    amount: amount,
    webhook: String(webhook)
  }

  console.log("[UnPay QR] Request Body:", JSON.stringify(requestBody))

  // CORRECT ENDPOINT
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