import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"
import { connectDB } from "./config/database"
import paymentRoutes from "./routes/payments"
import authRoutes from "./routes/auth"
import apiKeyRoutes from "./routes/payment-api"
import userRoutes from "./routes/user"
import adminRoutes from "./routes/admin"

const app = express()
const PORT = process.env.SERVER_PORT || 5000

// CORS FIX — THIS IS IMPORTANT
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.CLIENT_URL || "http://localhost:3000");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  next();
});


// CORS
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
)


app.use(express.json())

// Connect DB
connectDB().catch((error) => {
  console.error("Failed to connect to MongoDB:", error)
})

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "Orion-Pay Server is running" })
})

app.use("/api/auth", authRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/api-keys", apiKeyRoutes)
app.use("/api/user", userRoutes)
app.use("/api/admin", adminRoutes)

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error(err)
  res.status(500).json({ success: false, message: "Internal server error" })
})

app.listen(PORT, () => {
  console.log(`Orion-Pay Server running on port ${PORT}`)
})
