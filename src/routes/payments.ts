import express, { type Request, type Response } from "express"
import razorpay from "../config/razorpay"
import { createUnpayTransaction, createUnpayDynamicQR, getUnpayIp, decryptAES } from "../services/unpay"
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

router.get("/order-status/:orderId", async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params

    // Prefer latest status from MongoDB (includes webhook updates)
    try {
      const doc: any = await Transaction.findOne({ orderId })

      if (doc) {
        console.log("[Order Status] Fetched from DB for", orderId, "status:", doc.status)
        return res.status(200).json({
          success: true,
          data: {
            order_id: doc.orderId,
            status: doc.status,
            amount: doc.amount,
            currency: doc.currency,
            payment_id: doc.paymentId,
            created_at: doc.createdAt,
          },
        })
      }
    } catch (dbErr: any) {
      console.error("[Order Status] DB lookup failed for", orderId, "error:", dbErr.message)
      // fall through to in-memory fallback
    }

    // Fallback to in-memory map for very recent orders
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

// Create QR Code
router.post("/create-qr", authMiddleware, isVerified, async (req: Request, res: Response) => {
  try {
    const { amount, apitxnid, webhook } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      })
    }

    if (!apitxnid) {
      return res.status(400).json({
        success: false,
        message: "apitxnid is required",
      })
    }

    // Use provided webhook or default
    const webhookUrl = webhook || process.env.UNPAY_WEBHOOK_URL || `https://payments.versaitechnology.com/api/payments/webhook/unpay`

    console.log("[Create QR] Creating QR with payload:", { amount, apitxnid, webhook: webhookUrl })

    const qrResponse = await createUnpayDynamicQR({
      amount,
      apitxnid,
      customer_email: undefined, // Not needed for QR only
      currency: "INR",
      webhook: webhookUrl,
    })

    // Store transaction in database for webhook tracking
    try {
      await Transaction.create({
        userId: req.user?.id,
        orderId: apitxnid,
        paymentId: "",
        amount,
        currency: "INR",
        status: "pending",
        customer: {
          name: "",
          email: "",
          phone: "",
        },
        description: "QR Code Payment",
        notes: {
          qr_created: true,
          unpay_qr: qrResponse,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)
    } catch (err) {
      console.error("Failed to persist QR transaction:", err)
    }

    res.status(201).json({
      success: true,
      message: "QR Code Generated Successfully",
      data: qrResponse,
    })
  } catch (error: any) {
    console.error("Error creating QR code:", error)
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create QR code",
    })
  }
})

// Create Order
router.post("/create-order", authMiddleware, isVerified, async (req: Request, res: Response) => {
  try {
    console.log("RAZORPAY_KEY_ID IN USE:", process.env.RAZORPAY_KEY_ID);
    console.log("RAZORPAY_KEY_SECRET SET:", process.env.RAZORPAY_KEY_SECRET ? "YES" : "NO");
    
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
    
    // Call SMEPay only if selected or if no provider specified (backward compatibility)
    if (!selectedProvider || selectedProvider === "smepay") {
      try {
        const smepayResp = await createSmepayTransaction({
          amount,
          currency,
          description,
          customer: { name: notes?.name, email: notes?.email, phone: notes?.phone },
          metadata: { razorpay_order_id: order.id },
        })

        // attach smepay info to in-memory transaction
        ;(transaction as any).smepay = smepayResp

        // update DB record with smepay info if present
        try {
          await Transaction.findOneAndUpdate(
            { orderId: order.id },
            { $set: { "notes.smepay": smepayResp, updatedAt: new Date() } },
            { upsert: false },
          )
        } catch (err) {
          console.error("Failed to update DB with SMEPay response:", err)
        }
      } catch (err: any) {
        console.warn("SMEPay call failed (non-fatal):", err.message)
        ;(transaction as any).smepay_error = err.message
        // If SMEPay was specifically selected and failed, surface the error
        if (selectedProvider === "smepay") {
          ;(transaction as any).smepay_critical_error = err.message
        }
      }
    }

    // Call UnPay only if selected or if no provider specified (backward compatibility)
    // Determine if this environment should allow UnPay (prefer NODE_ENV, but also accept SERVER_URL)
    const isProdEnv = process.env.NODE_ENV === 'production' || (process.env.SERVER_URL && process.env.SERVER_URL.includes('versaitechnology.com'))

    // Safety: if CLIENT_URL explicitly contains localhost, treat as non-production
    const clientUrlIsLocal = !!process.env.CLIENT_URL && process.env.CLIENT_URL.includes('localhost')

    const allowUnPay = isProdEnv && !clientUrlIsLocal

    console.log("[PAYMENT GATEWAY MODE] [create-order]", {
      provider: selectedProvider || "auto",
      isProdEnv,
      clientUrlIsLocal,
      allowUnPay,
    })

    if ((!selectedProvider || selectedProvider === "unpay") && allowUnPay) {
      try {
        console.log("[UnPay][create-order] Requesting Dynamic QR with:", {
          amount,
          apitxnid: order.id,
          customer_email: notes?.email,
          currency: currency,
          webhook: process.env.UNPAY_WEBHOOK_URL,
        });
        const unpayResp = await createUnpayDynamicQR({
          amount,
          apitxnid: order.id,
          customer_email: notes?.email,
          currency: currency,
          webhook: process.env.UNPAY_WEBHOOK_URL,
        });

        // attach unpay info to in-memory transaction
        ;(transaction as any).unpay = unpayResp;

        // update DB record with unpay qr info
        try {
          await Transaction.findOneAndUpdate(
            { orderId: order.id },
            { $set: { "notes.unpay": unpayResp, updatedAt: new Date() } },
            { upsert: false },
          );
        } catch (err) {
          console.error("Failed to update DB with Unpay response:", err);
        }
      } catch (err: any) {
        console.warn("Unpay call failed (non-fatal):", err.message, err?.response?.data || "");
        ;(transaction as any).unpay_error = err.message;
        // If UnPay was specifically selected and failed, surface the error and details
        if (selectedProvider === "unpay") {
          ;(transaction as any).unpay_critical_error = err.message + (err?.response?.data ? ": " + JSON.stringify(err.response.data) : "");
        }
        // Return the actual UnPay error to the frontend if provider is unpay
        if (selectedProvider === "unpay") {
          return res.status(400).json({
            success: false,
            message: `UnPay error: ${err.message}` + (err?.response?.data ? ", Details: " + JSON.stringify(err.response.data) : ""),
          });
        }
      }
    } else if (selectedProvider === "unpay" && !allowUnPay) {
      // If UnPay is specifically selected but we're not in production, show error
      ;(transaction as any).unpay_error = "UnPay is not available in local development environment";
      ;(transaction as any).unpay_critical_error = "UnPay is not available in local development environment";
      return res.status(400).json({
        success: false,
        message: "UnPay is not available in local development environment",
      });
    }

    // Call Razorpay Payment Link and QR Code creation if selected
    let razorpayPaymentLink: any = null
    let razorpayQrCode: any = null
    
    // NOTE: Razorpay should NOT use payment links or QR - only order + checkout
    // Payment links/QR are optional and feature-restricted for Razorpay
    /*
    if (selectedProvider === "razorpay") {
      console.log("[Razorpay] Starting payment link/QR creation for Razorpay provider")
      console.log("[Razorpay] Environment keys:", {
        keyId: process.env.RAZORPAY_KEY_ID ? "set" : "not set",
        keySecret: process.env.RAZORPAY_KEY_SECRET ? "set" : "not set"
      })
      
      try {
        // Check if Razorpay is configured
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
          const error = "Razorpay keys not configured"
          console.error("[Razorpay]", error)
          ;(transaction as any).razorpay_error = error
        } else {
          // Use direct API calls instead of SDK methods for better compatibility
          const axios = require('axios')
          const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')
          
          // Create Payment Link
          const paymentLinkData = {
            amount: Math.round(amount * 100), // Convert to paise
            currency: currency || "INR",
            description: description || "Payment",
            customer: {
              name: notes?.name || "Customer",
              email: notes?.email || "",
              contact: notes?.phone || "",
            },
            notify: {
              sms: true,
              email: true,
            },
            reminder_enable: true,
            notes: {
              ...notes,
              razorpay_order_id: order.id,
            },
            callback_url: process.env.SERVER_URL ? `${process.env.SERVER_URL}/api/payments/webhook/razorpay` : "https://payments.versaitechnology.com/api/payments/webhook/razorpay",
            callback_method: "post",
          }

          console.log("[Razorpay] Creating payment link with data:", JSON.stringify(paymentLinkData, null, 2))
          
          try {
            const paymentLinkResponse = await axios.post('https://api.razorpay.com/v1/payment_links', paymentLinkData, {
              headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
              }
            })
            razorpayPaymentLink = paymentLinkResponse.data
            console.log("[Razorpay] Payment link created successfully:", razorpayPaymentLink?.id, razorpayPaymentLink?.short_url)
          } catch (linkErr: any) {
            console.error("[Razorpay] Payment link creation failed:", {
              message: linkErr.message,
              status: linkErr.response?.status,
              data: linkErr.response?.data
            })
            ;(transaction as any).razorpay_error = `Payment link creation failed: ${linkErr.message}`
          }

          // Create QR Code only if payment link was created
          if (razorpayPaymentLink?.id) {
            const qrCodeData = {
              type: "upi_qr",
              name: `Payment for ${description || "Order"}`,
              usage: "single_use",
              fixed_amount: true,
              payment_amount: Math.round(amount * 100),
              description: description || "Payment",
              notes: {
                ...notes,
                razorpay_order_id: order.id,
                payment_link_id: razorpayPaymentLink.id,
              },
            }

            console.log("[Razorpay] Creating QR code with data:", JSON.stringify(qrCodeData, null, 2))
            
            try {
              const qrCodeResponse = await axios.post('https://api.razorpay.com/v1/qr_codes', qrCodeData, {
                headers: {
                  'Authorization': `Basic ${auth}`,
                  'Content-Type': 'application/json'
                }
              })
              razorpayQrCode = qrCodeResponse.data
              console.log("[Razorpay] QR code created successfully:", razorpayQrCode?.id, razorpayQrCode?.image_url)
            } catch (qrErr: any) {
              console.error("[Razorpay] QR code creation failed:", {
                message: qrErr.message,
                status: qrErr.response?.status,
                data: qrErr.response?.data
              })
              // Don't fail if QR code fails, payment link is still usable
              ;(transaction as any).razorpay_qr_error = `QR code creation failed: ${qrErr.message}`
            }
          }

          // Update DB with Razorpay payment link and QR code info
          try {
            await Transaction.findOneAndUpdate(
              { orderId: order.id },
              { 
                $set: { 
                  "notes.razorpay_payment_link": razorpayPaymentLink,
                  "notes.razorpay_qr_code": razorpayQrCode,
                  updatedAt: new Date() 
                } 
              },
              { upsert: false },
            )
            console.log("[Razorpay] Database updated with payment link and QR code info")
          } catch (err) {
            console.error("[Razorpay] Failed to update DB with Razorpay payment link/QR:", err)
          }
        }
      } catch (err: any) {
        console.error("[Razorpay] Failed to create payment link/QR:", {
          message: err.message,
          status: err.statusCode,
          response: err.response?.data,
          stack: err.stack
        })
        // Don't fail the entire request if Razorpay payment link/QR creation fails
        ;(transaction as any).razorpay_error = err.message
      }
    }
    */

    // Extract UPI intents and official gateway hosted links from provider responses
    // CRITICAL: Only return UPI intents or official gateway links, NEVER frontend URLs
    
    // UnPay: Use qrString for Dynamic QR
    const unpayQrString = (transaction as any).unpay?.qrString
    const unpayLink = (unpayQrString && typeof unpayQrString === 'string') ? unpayQrString : null
    
    // SMEPay: Use ONLY payment_url (as per requirement - PRIMARY provider)
    // SMEPay service returns payment_url in the response - this is the official gateway link
    const smepayPaymentUrl = (transaction as any).smepay?.payment_url
    // CRITICAL: Use ONLY payment_url for SMEPay (primary provider requirement)
    const smepayLink = (smepayPaymentUrl && typeof smepayPaymentUrl === 'string') ? smepayPaymentUrl : null

    // Razorpay: Use payment link short URL
    const razorpayLink = razorpayPaymentLink?.short_url || null

    // Check for critical errors when specific provider is selected
    if (selectedProvider === "smepay" && (transaction as any).smepay_critical_error) {
      return res.status(400).json({
        success: false,
        message: `SMEPay error: ${(transaction as any).smepay_critical_error}`,
      })
    }
    
    if (selectedProvider === "unpay" && (transaction as any).unpay_critical_error) {
      return res.status(400).json({
        success: false,
        message: `UnPay error: ${(transaction as any).unpay_critical_error}`,
      })
    }
    
    if (selectedProvider === "razorpay" && (transaction as any).razorpay_error) {
      console.log("[Razorpay] Razorpay failed, but returning order info for checkout")
      // Don't return error, return the order info so user can do checkout
      // finalPaymentLink will be null, but order_id and key_id will be available for checkout
    }

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
    } else if (normalizedProvider === "razorpay") {
      finalPaymentLink = razorpayLink
    } else {
      // If no provider specified, fallback priority: SMEPay → UnPay → Razorpay
      finalPaymentLink = smepayLink || unpayLink || razorpayLink
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
        // Include QR code data if available
        qr_code: razorpayQrCode ? {
          id: razorpayQrCode.id,
          image_url: razorpayQrCode.image_url,
          upi_id: razorpayQrCode.upi_id,
          name: razorpayQrCode.name,
        } : null,
        // Provider-specific data for debugging
        provider_data: {
          razorpay: razorpayPaymentLink ? {
            payment_link_id: razorpayPaymentLink.id,
            short_url: razorpayPaymentLink.short_url,
            status: razorpayPaymentLink.status,
          } : null,
          smepay: (transaction as any).smepay || null,
          unpay: (transaction as any).unpay || null,
        },
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
router.get("/transaction/:orderId", async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params

    // Prefer canonical transaction from MongoDB so webhook updates are visible to users
    try {
      const doc: any = await Transaction.findOne({ orderId })

      if (doc) {
        console.log("[Transaction Detail] Fetched from DB for", orderId, "status:", doc.status)

        const data: any = {
          id: String(doc._id),
          order_id: doc.orderId,
          payment_id: doc.paymentId || "",
          amount: doc.amount,
          currency: doc.currency,
          status: doc.status,
          customer_email: doc.customer?.email,
          customer_name: doc.customer?.name,
          notes: doc.notes || {},
          created_at: doc.createdAt?.toISOString?.() || doc.createdAt,
          updated_at: doc.updatedAt?.toISOString?.() || doc.updatedAt,
          key_id: process.env.RAZORPAY_KEY_ID,
        }

        return res.status(200).json({
          success: true,
          data,
        })
      }
    } catch (dbErr: any) {
      console.error("[Transaction Detail] DB lookup failed for", orderId, "error:", dbErr.message)
      // fall through to in-memory fallback
    }

    // Fallback to in-memory map if DB record is missing
    const transaction = transactions.get(orderId)

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      })
    }

    res.status(200).json({
      success: true,
      data: {
        ...transaction,
        key_id: process.env.RAZORPAY_KEY_ID,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// Get All Transactions
router.get("/transactions", async (req: Request, res: Response) => {
  try {
    const allTransactions = await Transaction.find({}).sort({ createdAt: -1 }).limit(100)
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

// Razorpay Webhook Handler
router.post("/webhook/razorpay", async (req: Request, res: Response) => {
  try {
    console.log("[Razorpay Webhook] Received webhook:", {
      headers: req.headers,
      body: req.body,
      query: req.query,
    })

    // Razorpay sends webhook data in the body
    const webhookData = req.body

    if (!webhookData) {
      console.error("[Razorpay Webhook] No webhook data received")
      return res.status(400).json({ success: false, message: "No data received" })
    }

    // Extract event and payment data
    const { event, payment } = webhookData

    if (!event || !payment) {
      console.error("[Razorpay Webhook] Missing event or payment data")
      return res.status(400).json({ success: false, message: "Invalid webhook data" })
    }

    // Only process payment.captured events
    if (event !== "payment.captured") {
      console.log(`[Razorpay Webhook] Ignoring event: ${event}`)
      return res.status(200).json({ success: true, message: "Event ignored" })
    }

    const { order_id, id: payment_id, status, amount } = payment

    if (!order_id) {
      console.error("[Razorpay Webhook] Missing order_id")
      return res.status(400).json({ success: false, message: "Missing order_id" })
    }

    // Determine status mapping
    let dbStatus: string
    if (status === "captured") {
      dbStatus = "completed"
    } else if (status === "failed") {
      dbStatus = "failed"
    } else {
      dbStatus = "pending"
    }

    console.log(`[Razorpay Webhook] Updating transaction ${order_id} to status: ${dbStatus}`)

    // Update transaction in database
    try {
      const updateResult = await Transaction.findOneAndUpdate(
        { orderId: order_id },
        {
          $set: {
            paymentId: payment_id,
            status: dbStatus,
            updatedAt: new Date(),
            "notes.razorpay_webhook": {
              received_at: new Date(),
              event,
              payment_id,
              status,
              amount,
              raw_payload: webhookData,
            },
          },
        },
        { upsert: false, new: true }
      )

      if (!updateResult) {
        console.warn(`[Razorpay Webhook] Transaction ${order_id} not found in database`)
        return res.status(404).json({ success: false, message: "Transaction not found" })
      }

      console.log(`[Razorpay Webhook] Successfully updated transaction ${order_id}`)
    } catch (err: any) {
      console.error("[Razorpay Webhook] Database update failed:", err.message)
      return res.status(500).json({ success: false, message: "Database update failed" })
    }

    // Respond to Razorpay
    res.status(200).json({ success: true, message: "Webhook processed successfully" })
  } catch (error: any) {
    console.error("[Razorpay Webhook] Unexpected error:", error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
})

// SMEPay Webhook Handler
router.post("/webhook/smepay", async (req: Request, res: Response) => {
  console.log("[SMEPay Webhook] ===== WEBHOOK RECEIVED =====")
  try {
    // Log all incoming webhook data for debugging
    const webhookLog = {
      received_at: new Date(),
      headers: req.headers,
      body: req.body,
      query: req.query,
      remoteAddress: req.socket?.remoteAddress,
      remoteFamily: req.socket?.remoteFamily,
      remotePort: req.socket?.remotePort,
    };
    console.log("[SMEPay Webhook] Received webhook:", webhookLog);

    // SMEPay may send different identifiers; prefer order_id but fall back to ref_id
    const body = req.body as any
    const rawOrderId = body.order_id || body.orderId
    const rawRefId = body.ref_id || body.refId

    if (!rawOrderId && !rawRefId) {
      console.error("[SMEPay Webhook] Missing order identifier (order_id/ref_id)")
      return res.status(400).json({ success: false, message: "Missing order identifier" })
    }

    const candidateIds: string[] = []
    if (typeof rawOrderId === "string" && rawOrderId.trim()) candidateIds.push(rawOrderId.trim())
    if (typeof rawRefId === "string" && rawRefId.trim() && rawRefId !== rawOrderId)
      candidateIds.push(rawRefId.trim())

    const { status, amount, transaction_id } = body

    // Map SMEPay status values to internal status
    // SMEPay docs: SUCCESS, FAILED, PENDING
    let dbStatus: string
    let statusDisplay: string = "";
    switch ((status || "").toUpperCase()) {
      case "SUCCESS":
        dbStatus = "completed";
        statusDisplay = "Payment completed successfully ✅";
        break;
      case "FAILED":
        dbStatus = "failed";
        statusDisplay = "Payment failed ❌";
        break;
      case "PENDING":
        dbStatus = "pending";
        statusDisplay = "Payment in progress ⏳";
        break;
      default:
        dbStatus = "pending";
        statusDisplay = `Unknown status: ${status}`;
        break;
    }

    console.log("[SMEPay Webhook] Candidate orderIds for lookup:", candidateIds)
    console.log("[SMEPay Webhook] Resolved dbStatus:", dbStatus, "Display:", statusDisplay)

    // Update transaction in database using any of the candidate IDs
    try {
      const updateResult = await Transaction.findOneAndUpdate(
        { orderId: { $in: candidateIds } },
        {
          $set: {
            status: dbStatus,
            paymentId: transaction_id || "",
            updatedAt: new Date(),
            "notes.smepay_webhook": {
              received_at: new Date(),
              status,
              status_display: statusDisplay,
              amount,
              transaction_id,
              candidate_order_ids: candidateIds,
              raw_payload: body,
            },
            // Append webhook log for debugging (keep last 10 logs)
            $push: {
              "notes.smepay_webhook_logs": {
                $each: [webhookLog],
                $slice: -10
              }
            }
          },
        },
        { upsert: false, new: true }
      )

      if (!updateResult) {
        console.warn("[SMEPay Webhook] Transaction not found for any of:", candidateIds)
        return res.status(404).json({ success: false, message: "Transaction not found" })
      }

      console.log(
        "[SMEPay Webhook] Successfully updated transaction",
        updateResult.orderId,
        "to status:",
        dbStatus,
        "Display:",
        statusDisplay
      )
    } catch (err: any) {
      // Log error to DB for debugging
      try {
        await Transaction.updateOne(
          { orderId: { $in: candidateIds } },
          {
            $push: {
              "notes.smepay_webhook_error_logs": {
                received_at: new Date(),
                error: err.message,
                stack: err.stack,
                webhookLog,
              }
            }
          }
        );
      } catch (logErr) {
        console.error("[SMEPay Webhook] Failed to log DB error:", logErr);
      }
      console.error("[SMEPay Webhook] Database update failed:", err.message)
      return res.status(500).json({ success: false, message: "Database update failed" })
    }

    // Respond to SMEPay
    res.status(200).json({ success: true, message: "Webhook processed successfully" })
  } catch (error: any) {
    console.error("[SMEPay Webhook] Unexpected error:", error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
})

// UnPay Webhook Handler
router.post("/webhook/unpay", async (req: Request, res: Response) => {
  try {
    console.log("[UnPay Webhook] Received webhook:", {
      headers: req.headers,
      body: req.body,
      rawBody: (req as any).rawBody,
    })

    // UnPay sends encrypted payload in the body
    const encryptedData = req.body?.body || (req as any).rawBody
    if (!encryptedData) {
      console.error("[UnPay Webhook] No encrypted data received")
      return res.status(400).json({ success: false, message: "No data received" })
    }

    // Decrypt the webhook payload
    let webhookData: any
    try {
      const decryptedData = decryptAES(encryptedData)
      webhookData = JSON.parse(decryptedData)
      console.log("[UnPay Webhook] Decrypted payload:", webhookData)
    } catch (err: any) {
      console.error("[UnPay Webhook] Failed to decrypt/parse payload:", err.message)
      return res.status(400).json({ success: false, message: "Invalid webhook data" })
    }

    // Extract transaction details
    const { txnid, status, amount, upi_tr, message } = webhookData

    if (!txnid) {
      console.error("[UnPay Webhook] Missing transaction ID")
      return res.status(400).json({ success: false, message: "Missing transaction ID" })
    }

    // Determine status mapping
    let dbStatus: string
    if (status === "TXN") {
      dbStatus = "completed"
    } else if (status === "TXF" || status === "ER") {
      dbStatus = "failed"
    } else if (status === "TUP") {
      dbStatus = "pending"
    } else {
      dbStatus = "pending" // default
    }

    console.log(`[UnPay Webhook] Updating transaction ${txnid} to status: ${dbStatus}`)

    // Update transaction in database
    try {
      const updateResult = await Transaction.findOneAndUpdate(
        { orderId: txnid },
        {
          $set: {
            status: dbStatus,
            paymentId: upi_tr || "",
            updatedAt: new Date(),
            "notes.unpay_webhook": {
              received_at: new Date(),
              status,
              amount,
              upi_tr,
              message,
              raw_payload: webhookData,
            },
          },
        },
        { upsert: false, new: true }
      )

      if (!updateResult) {
        console.warn(`[UnPay Webhook] Transaction ${txnid} not found in database`)
        return res.status(404).json({ success: false, message: "Transaction not found" })
      }

      console.log(`[UnPay Webhook] Successfully updated transaction ${txnid}`)
    } catch (err: any) {
      console.error("[UnPay Webhook] Database update failed:", err.message)
      return res.status(500).json({ success: false, message: "Database update failed" })
    }

    // Respond to UnPay
    res.status(200).json({ success: true, message: "Webhook processed successfully" })
  } catch (error: any) {
    console.error("[UnPay Webhook] Unexpected error:", error)
    res.status(500).json({ success: false, message: "Internal server error" })
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
