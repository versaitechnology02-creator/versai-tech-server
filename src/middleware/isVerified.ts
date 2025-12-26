import { Request, Response, NextFunction } from "express"
import User from "../models/User"

type ReqWithUser = Request & { user?: { id?: string } }

export default async function isVerified(req: ReqWithUser, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" })
    }

    // Check both isVerified and verified fields for compatibility
    const user = await User.findById(userId).select("isVerified verified")
    if (!user) {
      return res.status(403).json({ success: false, message: "Your account is pending admin verification." })
    }

    // User is verified only if admin has verified them (isVerified = true)
    // verified field is for email verification, not sufficient for access
    const isUserVerified = user.isVerified === true
    
    if (!isUserVerified) {
      return res.status(403).json({ success: false, message: "Your account is pending admin verification." })
    }

    next()
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
}