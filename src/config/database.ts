import mongoose from 'mongoose'

let isConnected = false

export async function connectDB(mongoUri?: string): Promise<void> {
  if (isConnected) return

  const uri = mongoUri || process.env.MONGO || process.env.MONGO_URI || process.env.MONGODB_URI || ''
  if (!uri) {
    throw new Error('MONGO connection string is not provided')
  }

  await mongoose.connect(uri)
  isConnected = true
  console.log('MongoDB connected')
}

export async function disconnectDB(): Promise<void> {
  if (!isConnected) return
  await mongoose.disconnect()
  isConnected = false
  console.log('MongoDB disconnected')
}