import { SMEPAY_BASE_URL, SMEPAY_CLIENT_ID, SMEPAY_CLIENT_SECRET, smepayApiClient, smepayAuthClient } from "../config/smepay"

let cachedToken: { token: string; expiresAt: number } | null = null

async function getSmepayToken() {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token
  }

  if (!SMEPAY_CLIENT_ID || !SMEPAY_CLIENT_SECRET) {
    throw new Error("SMEPAY_CLIENT_ID or SMEPAY_CLIENT_SECRET is missing in environment variables")
  }

  console.log("[SMEPay] Authenticating with client_id:", SMEPAY_CLIENT_ID)
  const authResp = await smepayAuthClient
    .post("/wiz/external/auth", {
      client_id: SMEPAY_CLIENT_ID,
      client_secret: SMEPAY_CLIENT_SECRET,
    })
    .catch((err) => {
      console.error("[SMEPay] Auth error:", {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message
      })
      throw new Error(`SMEPay auth failed: ${err.response?.data?.message || err.message}`)
    })

  console.log("[SMEPay] Auth response data:", authResp.data)

  // Some SMEPay auth endpoints return token in headers; attempt to read common locations.
  const token = authResp.data?.token || authResp.data?.access_token || authResp.headers?.authorization || authResp.headers?.token
  if (!token) {
    throw new Error("SMEPay auth did not return a token")
  }

  // Assume token validity ~ 50 minutes if not provided
  const expiresInMs = (authResp.data?.expires_in || 3000) * 1000
  cachedToken = { token, expiresAt: now + expiresInMs }
  return token
}

export async function createSmepayTransaction(payload: {
  amount: number
  currency?: string
  description?: string
  customer?: { name?: string; email?: string; phone?: string }
  metadata?: Record<string, any>
}) {
  console.log("[SMEPay] Creating transaction with payload:", payload)
  const token = await getSmepayToken()

  const body = {
    client_id: SMEPAY_CLIENT_ID,
    amount: String(payload.amount || 0),
    order_id: payload.metadata?.razorpay_order_id || payload.metadata?.order_id || `smepay_${Date.now()}`,
    callback_url: process.env.SMEPAY_CALLBACK_URL || "https://payments.versaitechnology.com/api/payments/webhook/smepay",
    transaction_type: "payin", // Explicitly specify this is a Pay-In operation
    customer_details: {
      email: payload.customer?.email,
      mobile: payload.customer?.phone,
      name: payload.customer?.name,
    },
    // pass-through extras
    description: payload.description,
    metadata: payload.metadata,
  }

  console.log("[SMEPay] Request body:", JSON.stringify(body, null, 2))

  const resp = await smepayApiClient
    .post("/wiz/external/order/create", body, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    .catch((err) => {
      console.error("[SMEPay] Create order error:", {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message
      })
      throw new Error(`SMEPay create-order failed: ${err.response?.data?.message || err.message}`)
    })

  console.log("[SMEPay] Create order response:", JSON.stringify(resp.data, null, 2))

  const raw = resp.data
  const data = raw?.data || raw

  // Helper to find first string value whose key matches regex (depth-limited)
  const findValue = (obj: any, regex: RegExp, depth = 0): string | undefined => {
    if (!obj || typeof obj !== "object" || depth > 3) return undefined
    for (const [k, v] of Object.entries(obj)) {
      if (regex.test(k) && typeof v === "string" && v) return v
      if (typeof v === "object") {
        const found = findValue(v, regex, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }

  // Heuristics to surface slug/payment URL for the frontend
  const slug =
    data?.order_slug ||
    data?.slug ||
    data?.wizorder_slug ||
    data?.wiz_order_slug ||
    data?.orderSlug ||
    data?.order_id ||
    data?.orderId ||
    findValue(data, /slug|order/i)

  const paymentUrl =
    data?.payment_url ||
    data?.checkout_url ||
    data?.redirect_url ||
    data?.url ||
    data?.link ||
    data?.paymentLink ||
    data?.paymentlink ||
    data?.dqr_link ||
    data?.deeplink ||
    data?.upi_link ||
    data?.longurl ||
    findValue(data, /(url|link)$/i)

  return {
    ...raw,
    slug,
    order_slug: slug,
    payment_url: paymentUrl,
    checkout_url: paymentUrl,
  }
}
