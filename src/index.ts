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

app.use(
  cors({
    origin: ['https://payments.versaitechnology.com', 'http://payments.versaitechnology.com'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  })
)

app.use(express.json())

// Connect DB
const mongo = process.env.MONGO || process.env.MONGO_URI || ''
connectDB(mongo).catch((error) => {
  console.error('Failed to connect to MongoDB:', error)
})

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'Server is running' })
})

app.use('/api/auth', authRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/api-keys', apiKeyRoutes)
app.use('/api/user', userRoutes)
app.use('/api/admin', adminRoutes)

// Return consistent JSON for unknown routes instead of HTML
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` })
})

// Generic error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ success: false, message: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})