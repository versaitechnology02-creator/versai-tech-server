import smepayClient from "../config/smepay"

export async function createSmepayTransaction(payload: {
  amount: number
  currency?: string
  description?: string
  customer?: { name?: string; email?: string; phone?: string }
  metadata?: Record<string, any>
}) {
  // Minimal implementation for Smepay: create an invoice/transaction
  const body = {
    amount: Math.round((payload.amount || 0) * 100),
    currency: payload.currency || "INR",
    description: payload.description || "Payment via Smepay",
    customer: payload.customer || {},
    metadata: payload.metadata || {},
  }

  const resp = await smepayClient.post("/v1/payments", body).catch((err) => {
    throw new Error(`Smepay API error: ${err.response?.data?.message || err.message}`)
  })

  return resp.data
}
