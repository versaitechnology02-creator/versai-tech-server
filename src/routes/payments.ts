import express, { type Request, type Response } from "express"
import razorpay from "../config/razorpay"
import { createUnpayTransaction, createUnpayDynamicQR } from "../services/unpay"
import { createSmepayTransaction } from "../services/smepay"
import { verifySignature } from "../utils/crypto"
import type { CreateOrderRequest, VerifyPaymentRequest, PaymentTransaction } from "../types/payment"
import Transaction from "../models/Transaction"
import User from "../models/User"
import authMiddleware from "../middleware/authMiddleware"
import isVerified from "../middleware/isVerified"
import { sseManager } from "../utils/sse"

const router = express.Router()

// In-memory store for transactions
const transactions: Map<string, PaymentTransaction> = new Map()
const paymentLinks: Map<string, any> = new Map()
const payouts: Map<string, any> = new Map()

// Test endpoint to get UnPay server IP (for whitelisting)
router.get("/test/unpay-ip", async (req: Request, res: Response) => {
  try {
    // getUnpayIp removed from service as per new strict requirements
    // Returning placeholder or checking external service if really needed
    // For now, disabling this endpoint or returning mock to fix build
    res.status(200).json({
      success: true,
      message: "UnPay IP check disabled in this version",
      ip: "0.0.0.0",
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

// Real-time Payment Status Stream (SSE)
router.get("/stream/:orderId", (req: Request, res: Response) => {
  const { orderId } = req.params

  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  console.log(`[SSE] Client connected to stream for order: ${orderId}`)

  // Register client
  sseManager.addClient(orderId, res)

  // Send initial connected message
  res.write(`data: ${JSON.stringify({ type: "connected", orderId })}\n\n`)

  // Cleanup on close is handled by SSEManager via res.on('close')
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

    // Use provided webhook or default (✅ FIXED: Use correct production webhook URL)
    const webhookUrl = webhook || process.env.UNPAY_WEBHOOK_URL
    if (!webhookUrl) {
      throw new Error("UNPAY_WEBHOOK_URL is not configured")
    }

    console.log("[Create QR] Creating QR with payload:", { amount, apitxnid, webhook: webhookUrl })

    const qrResponse = await createUnpayDynamicQR({
      amount,
      apitxnid,
      webhook: webhookUrl,
    })

    // Store transaction in database for webhook tracking
    try {
      await Transaction.create({
        userId: (req as any).user?.id,
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
      console.error("[Create Order] Validation Error: Invalid amount", {
        body: req.body
      });
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
        debug: { body: req.body }
      });
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
    };

    transactions.set(order.id, transaction);

    // Persist to MongoDB (userId optional)
    try {
      await Transaction.create({
        userId: (req as any).user?.id,
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
      } as any);
    } catch (err) {
      console.error("[Create Order] Failed to persist transaction:", err, {
        body: req.body
      });
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
          ; (transaction as any).smepay = smepayResp

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
          ; (transaction as any).smepay_error = err.message
        // If SMEPay was specifically selected and failed, surface the error
        if (selectedProvider === "smepay") {
          ; (transaction as any).smepay_critical_error = err.message
        }
      }
    }

    // Call UnPay only if selected or if no provider specified (backward compatibility)
    // Determine if this environment should allow UnPay
    const forceEnableUnpay = process.env.UNPAY_ENABLED === 'true'
    const isProdEnv = process.env.NODE_ENV === 'production' || (process.env.SERVER_URL && process.env.SERVER_URL.includes('versaitechnology.com'))

    // Safety: if CLIENT_URL explicitly contains localhost, treat as non-production (unless forced)
    const clientUrlIsLocal = !!process.env.CLIENT_URL && process.env.CLIENT_URL.includes('localhost')

    // Allow if forced OR (isProd AND not local client)
    const allowUnPay = forceEnableUnpay || (isProdEnv && !clientUrlIsLocal)

    console.log("[PAYMENT GATEWAY MODE] [create-order]", {
      provider: selectedProvider || "auto",
      isProdEnv,
      clientUrlIsLocal,
      forceEnableUnpay,
      allowUnPay,
    })

    if ((!selectedProvider || selectedProvider === "unpay") && allowUnPay) {
      try {
        console.log("[UnPay][create-order] Requesting Dynamic QR with:", {
          amount,
          apitxnid: order.id,
          // REMOVED EXTRA FIELDS FROM LOGGING
          webhook: process.env.UNPAY_WEBHOOK_URL,
        });

        const unpayResp = await createUnpayDynamicQR({
          amount,
          apitxnid: order.id,
          webhook: process.env.UNPAY_WEBHOOK_URL,
        });

        // attach unpay info to in-memory transaction
        ; (transaction as any).unpay = unpayResp;

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
        ; (transaction as any).unpay_error = err.message;
        // If UnPay was specifically selected and failed, surface the error and details
        if (selectedProvider === "unpay") {
          const detail = err?.response?.data ? ": " + JSON.stringify(err.response.data) : "";
          ; (transaction as any).unpay_critical_error = err.message + detail;
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
      // If UnPay is specifically selected but we're not allowed, show error
      const msg = "UnPay is disabled in this environment (UNPAY_ENABLED implies false)"
        ; (transaction as any).unpay_error = msg;
      ; (transaction as any).unpay_critical_error = msg;
      return res.status(400).json({
        success: false,
        message: msg,
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
              contact: true,
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

export default router
