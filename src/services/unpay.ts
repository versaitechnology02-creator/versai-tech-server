import unpayClient from "../config/unpay"

export async function createUnpayTransaction(payload: {
  amount: number
  currency?: string
  description?: string
  customer?: { name?: string; email?: string; phone?: string }
  metadata?: Record<string, any>
}) {
  // Minimal implementation using Unpay's API: create a payment/invoice endpoint.
  // The exact endpoint and payload may need adjustment according to Unpay docs.
  const body = {
    amount: Math.round((payload.amount || 0) * 100),
    currency: payload.currency || "INR",
    description: payload.description || "Payment via Unpay",
    customer: payload.customer || {},
    metadata: payload.metadata || {},
  }

  const resp = await unpayClient.post("/v1/payments", body).catch((err) => {
    // rethrow a clean error
    throw new Error(`Unpay API error: ${err.response?.data?.message || err.message}`)
  })

  // Return important identifiers; adapt as per Unpay response format
  return resp.data
}
