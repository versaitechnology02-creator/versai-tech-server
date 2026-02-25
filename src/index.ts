import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// Robust .env loading - check multiple locations
const possiblePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env')
]

let loaded = false
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    console.log(`🔍 Found .env at: ${p}`)
    const result = dotenv.config({ path: p, override: true })  // override: true ensures .env always wins over PM2 cached env
    if (!result.error) {
      console.log('✅ .env file loaded successfully')
      loaded = true
      break
    }
  }
}

if (!loaded) {
  console.warn('⚠️ No .env file found or loaded in any expected location')
}

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'

import { connectDB } from './config/database'
import paymentRoutes from './routes/payments'
import authRoutes from './routes/auth'
import apiKeyRoutes from './routes/payment-api'
import userRoutes from './routes/user'
import adminRoutes from './routes/admin'
import { razorpayWebhookHandler } from './controllers/webhookController'
import { startPaymentPolling } from './utils/paymentPoller'
import unpayRoutes from './routes/unpay'
import rezoPayoutRoutes from './routes/rezopay-payout'

const app = express()
const PORT = Number(process.env.PORT || process.env.SERVER_PORT) || 5000

/* =========================================================
   TRUST PROXY (IMPORTANT)
========================================================= */
app.set('trust proxy', true)

/* =========================================================
   CORS CONFIG (BULLETPROOF)
   ========================================================= */

const ALLOWED_ORIGINS = [
  'https://payments.versaitechnology.com',
  'https://versaitechnology.com',
  'https://www.versaitechnology.com',
  'http://localhost:3000',
  'http://localhost:5173'
]

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow server-to-server, webhooks, Postman (no origin)
    if (!origin) return callback(null, true)

    // Check against allowed exact list
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true)
    }

    // Allow subdomains (e.g. admin.versaitechnology.com)
    if (origin.endsWith('.versaitechnology.com')) {
      return callback(null, true)
    }

    // In production, block unknown origins
    console.warn(`Blocked CORS for origin: ${origin}`)
    return callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  preflightContinue: false,
  optionsSuccessStatus: 204
}

// Enable Pre-Flight for ALL routes specifically
app.options('*', cors(corsOptions))

// Enable CORS for ALL routes
app.use(cors(corsOptions))

/* =========================================================
   WEBHOOKS (MUST BE BEFORE BODY PARSER)
========================================================= */

// Razorpay Webhook - Requires RAW body for signature verification
app.post(
  "/api/payments/webhook/razorpay",
  express.raw({ type: "application/json" }),
  razorpayWebhookHandler
)

// UnPay Webhook - Registered URL in UnPay dashboard: /api/payments/webhook/unpay
// ⚠️  CRITICAL: UnPay sends REAL payment callbacks as GET with query params!
//     (e.g. ?statuscode=TXN&apitxnid=...&txnid=...&utr=...)
// Both GET and POST must be handled.
app.get("/api/payments/webhook/unpay", (req, res, next) => {
  console.log("[UnPay Webhook] GET Hit via /api/payments/webhook/unpay")
  req.url = '/callback'
    ; (unpayRoutes as any).handle(req, res, next)
})
app.post("/api/payments/webhook/unpay", express.json(), (req, res, next) => {
  console.log("[UnPay Webhook] POST Hit via /api/payments/webhook/unpay")
  req.url = '/callback'
    ; (unpayRoutes as any).handle(req, res, next)
})

// RezoPay Payout Callback — Public webhook (registered in RezoPay merchant panel)
// MUST be before express.json() body parser so body is available for future HMAC use
app.post(
  "/api/gateway-payouts/callback",
  express.json(),
  (req, res, next) => {
    console.log("[RezoPay Payout Callback] POST Hit")
    req.url = '/callback'
      ; (rezoPayoutRoutes as any).handle(req, res, next)
  }
)

/* =========================================================
   MIDDLEWARES
========================================================= */

app.use(express.json())

/* =========================================================
   DATABASE
========================================================= */

const mongoUri = process.env.MONGODB_URI
if (!mongoUri) {
  console.error('❌ MONGODB_URI missing')
  process.exit(1)
}

connectDB(mongoUri)
  .then(() => {
    console.log('MongoDB connected')
    // Start background payment status polling (safety net for missed webhooks)
    startPaymentPolling()
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err)
    process.exit(1)
  })

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, status: 'Server is running' })
})

/* =========================================================
   ROUTES
========================================================= */

app.use('/api/auth', authRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/api-keys', apiKeyRoutes)
app.use('/api/user', userRoutes)
app.use('/api/admin', adminRoutes)
// /api/unpay/* - keeps old paths working (alias: /api/unpay/callback)
app.use('/api/unpay', unpayRoutes)
import payoutRoutes from './routes/payouts'
app.use('/api/payouts', payoutRoutes)
import adminPayoutRoutes from './routes/admin_payouts'
app.use('/api/admin/payouts', adminPayoutRoutes)
// RezoPay Gateway Payout routes
app.use('/api/gateway-payouts', rezoPayoutRoutes)

// Legacy SMEPay callback path used by provider: /api/smepay/callback
// Rewrite to existing /api/payments/webhook/smepay handler without changing router structure
app.post('/api/smepay/callback', (req: Request, res: Response, next: NextFunction) => {
  // TODO: If SMEPay webhook logic is moved to webhookController, update this too.
  // For now, redirecting to paymentRoutes which extracts body. 
  // NOTE: If SMEPay needs raw body, this will fail because express.json() is now global above.
  // Assuming SMEPay sends standard JSON and doesn't require raw body signature verification
  // or that verif happens on parsed body.
  req.url = '/webhook/smepay'
    ; (paymentRoutes as any).handle(req, res, next)
})

/* =========================================================
   404 HANDLER
========================================================= */

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  })
})

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('🔥 Server Error:', err)
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    })
  }
)

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`🌍 SERVER_URL: ${process.env.SERVER_URL || 'Not Set'}`)
  console.log(`🔗 UNPAY_WEBHOOK_URL: ${process.env.UNPAY_WEBHOOK_URL || 'Not Set'}`)
  console.log(`🔗 SMEPAY_CALLBACK_URL: ${process.env.SMEPAY_CALLBACK_URL || 'Not Set'}`)
  console.log(`🔗 REZOPAY_CALLBACK_URL: ${process.env.REZOPAY_CALLBACK_URL || 'Set in merchant panel: POST /api/gateway-payouts/callback'}`)
  console.log(`💳 REZOPAY_API_KEY: ${process.env.REZOPAY_API_KEY ? '✅ Set' : '❌ NOT SET — add to .env'}`)
})