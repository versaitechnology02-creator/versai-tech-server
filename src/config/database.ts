import mongoose from "mongoose"

let isConnected = false

export async function connectDB() {
  if (isConnected) {
    return
  }

  try {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) {
      throw new Error("MONGODB_URI is not defined in environment variables")
    }

    await mongoose.connect(mongoUri)
    isConnected = true
    console.log("MongoDB connected successfully")
  } catch (error) {
    console.error("MongoDB connection failed:", error)
    throw error
  }
}

export async function disconnectDB() {
  if (!isConnected) {
    return
  }

  try {
    await mongoose.disconnect()
    isConnected = false
    console.log("MongoDB disconnected")
  } catch (error) {
    console.error("MongoDB disconnection failed:", error)
    throw error
  }
}
