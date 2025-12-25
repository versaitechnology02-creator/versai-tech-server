import express, { type Request, type Response } from "express"
import razorpay from "../config/razorpay"
import { createUnpayTransaction, getUnpayIp } from "../services/unpay"
import { createSmepayTransaction } from "../services/smepay"
import { verifySignature } from "../utils/crypto"
import type { CreateOrderRequest, VerifyPaymentRequest, PaymentTransaction } from "../types/payment"
import Transaction from "../models/Transaction"
import authMiddleware from "../middleware/authMiddleware"
import isVerified from "../middleware/isVerified"

const router = express.Router()

// In-memory store for transactions
const transactions: Map<string, PaymentTransaction> = new Map()
const paymentLinks: Map<string, any> = new Map()
const payouts: Map<string, any> = new Map()

// Test endpoint to get UnPay server IP (for whitelisting)
router.get("/test/unpay-ip", async (req: Request, res: Response) => {
  try {
    const ip = await getUnpayIp()
    res.status(200).json({
      success: true,
      message: "Contact UnPay support to whitelist this IP",
      ip,
    })
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message,
    })
  }
})

router.post("/generate-link", authMiddleware, isVerified, async (req: Request, res: Response) => {
  // REMOVED: This route creates frontend URLs which violate UPI intent requirements
  return res.status(410).json({
    success: false,
    message: "This endpoint is deprecated. Use /create-order for direct UPI links."
  })
})

router.post("/deep-link", authMiddleware, isVerified, async (req: Request, res: Response) => {
  // REMOVED: This route creates frontend URLs which violate UPI intent requirements
  return res.status(410).json({
    success: false,
    message: "This endpoint is deprecated. Use /create-order for direct UPI links."
  })
})

router.post("/payout", async (req: Request, res: Response) => {
  try {
    const { amount, recipient_email, recipient_name, description } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      })
    }

    if (!recipient_email) {
      return res.status(400).json({
        success: false,
        message: "Recipient email is required",
      })
    }

    const payoutId = `payout_${Date.now()}`
    const payout = {
      payout_id: payoutId,
      amount,
      recipient_email,
      recipient_name,
      description,
      status: "processing",
      created_at: new Date().toISOString(),
      method: "bank_transfer",
    }

    payouts.set(payoutId, payout)

    res.status(201).json({
      success: true,
      data: payout,
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

router.post("/payout-upi", async (req: Request, res: Response) => {
  try {
    const { amount, upi_id, recipient_name, description } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      })
    }

    if (!upi_id) {
      return res.status(400).json({
        success: false,
        message: "UPI ID is required",
      })
    }

    const payoutId = `payout_upi_${Date.now()}`
    const payout = {
      payout_id: payoutId,
      amount,
      upi_id,
      recipient_name,
      description,
      status: "success",
      created_at: new Date().toISOString(),
      method: "upi",
    }

    payouts.set(payoutId, payout)

    res.status(201).json({
      success: true,
      data: payout,
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

router.get("/order-status/:orderId", (req: Request, res: Response) => {
  try {
    const { orderId } = req.params
    const transaction = transactions.get(orderId)

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      })
    }

    res.status(200).json({
      success: true,
      data: {
        order_id: transaction.order_id,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        payment_id: transaction.payment_id,
        created_at: transaction.created_at,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

router.get("/settlements", (req: Request, res: Response) => {
  try {
    const settlements = [
      {
        id: "settlement_001",
        amount: 50000,
        status: "completed",
        date: new Date().toISOString(),
      },
    ]

    res.status(200).json({
      success: true,
      data: settlements,
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// Create Order
router.post("/create-order", authMiddleware, isVerified, async (req: Request, res: Response) => {
  try {
    const { amount, currency = "INR", description, customer_id, receipt, notes, provider } = req.body as CreateOrderRequest & { provider?: string }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      })
    }

    const order: any = await (razorpay as any).orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
      description,
      notes: {
        ...(notes as any),
        customer_id: customer_id ?? null,
      },
    })

    // Store transaction in-memory and persist to DB
    const transaction: PaymentTransaction = {
      id: `txn_${Date.now()}`,
      order_id: order.id,
      payment_id: "",
      amount,
      currency,
      status: "pending",
      customer_email: notes?.email,
      customer_name: notes?.name,
      notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    transactions.set(order.id, transaction)

    // Persist to MongoDB (userId optional)
    try {
      await Transaction.create({
        userId: notes?.customer_id || null,
        orderId: order.id,
        paymentId: "",
        amount,
        currency,
        status: "pending",
        customer: {
          name: notes?.name || "",
          email: notes?.email || "",
          phone: notes?.phone || "",
        },
        description: description || "",
        notes: notes || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)
    } catch (err) {
      console.error("Failed to persist transaction:", err)
    }

    // Call only the selected provider (or both if no provider specified for backward compatibility)
    // This ensures money goes to the correct merchant account
    const selectedProvider = provider?.toLowerCase()
    
    // Call UnPay only if selected or if no provider specified (backward compatibility)
    // Skip UnPay in local development to avoid IP whitelisting issues
    if ((!selectedProvider || selectedProvider === "unpay") && !process.env.CLIENT_URL?.includes('localhost')) {
      try {
        const unpayResp = await createUnpayTransaction({
          amount,
          currency,
          description,
          customer: { name: notes?.name, email: notes?.email, phone: notes?.phone },
          metadata: { razorpay_order_id: order.id },
        })

        // attach unpay info to in-memory transaction
        ;(transaction as any).unpay = unpayResp

        // update DB record with unpay id if present
        try {
          await Transaction.findOneAndUpdate(
            { orderId: order.id },
            { $set: { "notes.unpay": unpayResp, updatedAt: new Date() } },
            { upsert: false },
          )
        } catch (err) {
          console.error("Failed to update DB with Unpay response:", err)
        }
      } catch (err: any) {
        console.warn("Unpay call failed (non-fatal):", err.message)
        ;(transaction as any).unpay_error = err.message
        // If UnPay was specifically selected and failed, surface the error
        if (selectedProvider === "unpay") {
          ;(transaction as any).unpay_critical_error = err.message
        }
      }
    } else if (selectedProvider === "unpay" && process.env.CLIENT_URL?.includes('localhost')) {
      // If UnPay is specifically selected but we're in local dev, show error
      ;(transaction as any).unpay_error = "UnPay is not available in local development environment"
      ;(transaction as any).unpay_critical_error = "UnPay is not available in local development environment"
    }

    // Call SMEPay only if selected or if no provider specified (backward compatibility)
    // SMEPay is PRIMARY provider - prioritize it
    if (!selectedProvider || selectedProvider === "smepay") {
      try {
        const smepayResp = await createSmepayTransaction({
          amount,
          currency,
          description,
          customer: { name: notes?.name, email: notes?.email, phone: notes?.phone },
          metadata: { razorpay_order_id: order.id },
        })

        ;(transaction as any).smepay = smepayResp

        try {
          await Transaction.findOneAndUpdate(
            { orderId: order.id },
            { $set: { "notes.smepay": smepayResp, updatedAt: new Date() } },
            { upsert: false },
          )
        } catch (err) {
          console.error("Failed to update DB with Smepay response:", err)
        }
      } catch (err: any) {
        console.warn("Smepay call failed (non-fatal):", err.message)
        ;(transaction as any).smepay_error = err.message
        // Surface critical errors to client
        if (err.message.includes("wallet balance") || err.message.includes("auth failed")) {
          ;(transaction as any).smepay_critical_error = err.message
        }
        // If SMEPay was specifically selected and failed, surface the error
        if (selectedProvider === "smepay") {
          ;(transaction as any).smepay_critical_error = err.message
        }
      }
    }

    // Extract UPI intents and official gateway hosted links from provider responses
    // CRITICAL: Only return UPI intents or official gateway links, NEVER frontend URLs
    
    // UnPay: Prioritize UPI intent, fallback to official UnPay hosted link
    const unpayUpiIntent = (transaction as any).unpay?.upi_intent
    const unpayPaymentUrl = (transaction as any).unpay?.payment_url
    const unpayLink = (unpayUpiIntent && typeof unpayUpiIntent === 'string') ? unpayUpiIntent : 
                     (unpayPaymentUrl && typeof unpayPaymentUrl === 'string') ? unpayPaymentUrl : null
    
    // SMEPay: Use ONLY payment_url (as per requirement - PRIMARY provider)
    // SMEPay service returns payment_url in the response - this is the official gateway link
    const smepayPaymentUrl = (transaction as any).smepay?.payment_url
    // CRITICAL: Use ONLY payment_url for SMEPay (primary provider requirement)
    const smepayLink = (smepayPaymentUrl && typeof smepayPaymentUrl === 'string') ? smepayPaymentUrl : null

    // Return the payment link based on selected provider (normalized to lowercase)
    // If provider is specified, return only that provider's link
    let finalPaymentLink: string | null = null
    
    // Normalize provider for comparison (frontend may send "SMEPay", "UnPay", "smepay", etc.)
    // selectedProvider is already lowercased, use it directly
    const normalizedProvider = selectedProvider || null
    
    if (normalizedProvider === "smepay") {
      finalPaymentLink = smepayLink
    } else if (normalizedProvider === "unpay") {
      finalPaymentLink = unpayLink
    } /* else if (normalizedProvider === "razorpay") {
      // Razorpay is checkout-only, not for direct links or QR
      finalPaymentLink = null
    } */ else {
      // If no provider specified, fallback priority: SMEPay → UnPay
      finalPaymentLink = smepayLink || unpayLink
    }

    // Log payment link for debugging
    console.log(`[Payment] Provider: ${normalizedProvider || 'none'}, Payment Link: ${finalPaymentLink || 'null'}`)
    
    res.status(201).json({
      success: true,
      data: {
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
        // Return SINGLE payment_link field (null if unavailable)
        final_payment_link: finalPaymentLink,
      },
    })
  } catch (error: any) {
    console.error("Error creating order:", error)
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create order",
    })
  }
})

// Verify Payment
router.post("/verify-payment", async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as VerifyPaymentRequest

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing payment details",
      })
    }

    // Verify signature
    const isSignatureValid = verifySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET || "",
    )

    if (!isSignatureValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      })
    }

    // Fetch payment details from Razorpay
    const payment = await razorpay.payments.fetch(razorpay_payment_id)

    // Update in-memory transaction and DB record
    const transaction = transactions.get(razorpay_order_id)
    if (transaction) {
      transaction.payment_id = razorpay_payment_id
      transaction.status = payment.status === "captured" ? "completed" : "pending"
      transaction.updated_at = new Date().toISOString()
    }

    try {
      await Transaction.findOneAndUpdate(
        { orderId: razorpay_order_id },
        {
          $set: {
            paymentId: razorpay_payment_id,
            status: payment.status === "captured" ? "completed" : "pending",
            updatedAt: new Date(),
          },
        },
        { upsert: false },
      )
    } catch (err) {
      console.error("Failed to update DB transaction:", err)
    }

    res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
    })
  } catch (error: any) {
    console.error("Error verifying payment:", error)
    res.status(500).json({
      success: false,
      message: error.message || "Failed to verify payment",
    })
  }
})

// Get Transaction by Order ID
router.get("/transaction/:orderId", (req: Request, res: Response) => {
  try {
    const { orderId } = req.params
    const transaction = transactions.get(orderId)

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      })
    }

    res.status(200).json({
      success: true,
      data: transaction,
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// Get All Transactions
router.get("/transactions", (req: Request, res: Response) => {
  try {
    const allTransactions = Array.from(transactions.values())
    res.status(200).json({
      success: true,
      data: allTransactions,
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// Get Refund
router.post("/refund", async (req: Request, res: Response) => {
  try {
    const { payment_id, amount } = req.body

    if (!payment_id) {
      return res.status(400).json({
        success: false,
        message: "Payment ID is required",
      })
    }

    const refund: any = await (razorpay as any).refunds.create({
      payment_id,
      amount: amount ? Math.round(amount * 100) : undefined,
    })

    res.status(200).json({
      success: true,
      data: refund,
    })
  } catch (error: any) {
    console.error("Error processing refund:", error)
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process refund",
    })
  }
})

export default router
