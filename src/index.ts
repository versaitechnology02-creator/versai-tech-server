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
   CORS CONFIG (IMPORTANT)
========================================================= */

const allowedOrigins = [
  'https://payments.versaitechnology.com',
  'http://localhost:3000'
]

app.use(
  cors({
    origin: (origin, callback) => {
      // allow REST tools like Postman, curl
      if (!origin) return callback(null, true)

      if (allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
)

// handle preflight requests
app.options('*', cors())

/* =========================================================
   MIDDLEWARES
========================================================= */

app.use(express.json())

/* =========================================================
   DATABASE
========================================================= */

const mongo = process.env.MONGO || process.env.MONGO_URI || ''
connectDB(mongo).catch((error) => {
  console.error('❌ MongoDB connection failed:', error)
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
