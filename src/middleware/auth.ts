import type { Request, Response, NextFunction } from "express"
import { verifyToken } from "../utils/jwt"

export interface AuthRequest extends Request {
  userId?: string
  apiKey?: string
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Check for API Key authentication
    const apiKey = req.headers["x-api-key"] as string
    if (apiKey) {
      // Validate API key from database
      req.apiKey = apiKey
      return next()
    }

    // Check for JWT token
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - No token provided",
      })
    }

    const token = authHeader.substring(7)
    const decoded = verifyToken(token)

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - Invalid token",
      })
    }

    req.userId = decoded.userId
    next()
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Unauthorized",
    })
  }
}
