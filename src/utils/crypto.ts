import crypto from "crypto"

export function generateSignature(orderId: string, paymentId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex")
}

export function verifySignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  const expectedSignature = generateSignature(orderId, paymentId, secret)
  return expectedSignature === signature
}
