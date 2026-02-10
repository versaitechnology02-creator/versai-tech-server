import dotenv from 'dotenv'
dotenv.config()

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'

import { connectDB } from './config/database'
import paymentRoutes from './routes/payments'
import authRoutes from './routes/auth'
import apiKeyRoutes from './routes/payment-api'
import userRoutes from './routes/user'
import adminRoutes from './routes/admin'

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
  .then(() => console.log('MongoDB connected'))
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

// Legacy SMEPay callback path used by provider: /api/smepay/callback
// Rewrite to existing /api/payments/webhook/smepay handler without changing router structure
app.post('/api/smepay/callback', (req: Request, res: Response, next: NextFunction) => {
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
})