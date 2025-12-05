import Razorpay from "razorpay"

const keyId = process.env.RAZORPAY_KEY_ID
const keySecret = process.env.RAZORPAY_KEY_SECRET

let razorpay: any

if (keyId && keySecret) {
  razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  })
} else {
  console.warn(
    "Razorpay keys are not set (Razorpay client will be a stub). Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your environment to enable real Razorpay operations.",
  )

  // Minimal stub to avoid runtime crashes during development when keys are missing.
  razorpay = {
    orders: {
      create: async () => {
        throw new Error("Razorpay keys not configured: cannot create order")
      },
    },
    payments: {
      fetch: async () => {
        throw new Error("Razorpay keys not configured: cannot fetch payment")
      },
    },
    refunds: {
      create: async () => {
        throw new Error("Razorpay keys not configured: cannot create refund")
      },
    },
  }
}

export default razorpay
