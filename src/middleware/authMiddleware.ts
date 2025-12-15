import { Request, Response, NextFunction } from "express"
import { verifyToken } from "../utils/jwt"

export default function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" })
  }

  const token = authHeader.split(" ")[1]
  const decoded = verifyToken(token)

  if (!decoded) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" })
  }

  // attach user id to the request - cast to `any` so TypeScript allows this
  ;(req as any).user = { id: decoded.userId }
  next()
}