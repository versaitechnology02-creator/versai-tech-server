import express, { type Response } from "express"
import crypto from "crypto"
import ApiKey from "../models/ApiKey"
import { type AuthRequest, authMiddleware } from "../middleware/auth"

const router = express.Router()

// Generate API Key
router.post("/generate", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body
    const userId = req.userId

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      })
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "API key name is required",
      })
    }

    // Generate unique key and secret
    const key = `orion_${crypto.randomBytes(16).toString("hex")}`
    const secret = crypto.randomBytes(32).toString("hex")

    const apiKey = await ApiKey.create({
      userId,
      name,
      key,
      secret,
    })

    res.status(201).json({
      success: true,
      message: "API key generated successfully",
      data: {
        id: apiKey._id,
        name: apiKey.name,
        key: apiKey.key,
        secret: apiKey.secret,
        createdAt: apiKey.createdAt,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// Get All API Keys
router.get("/list", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      })
    }

    const apiKeys = await ApiKey.find({ userId })

    res.status(200).json({
      success: true,
      data: apiKeys,
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// Delete API Key
router.delete("/:keyId", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { keyId } = req.params
    const userId = req.userId

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      })
    }

    const apiKey = await ApiKey.findById(keyId)
    if (!apiKey) {
      return res.status(404).json({
        success: false,
        message: "API key not found",
      })
    }

    if (apiKey.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      })
    }

    await ApiKey.deleteOne({ _id: keyId })

    res.status(200).json({
      success: true,
      message: "API key deleted successfully",
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

export default router
