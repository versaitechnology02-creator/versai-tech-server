import express, { type Request, type Response } from "express"
import User from "../models/User"
import bcrypt from "bcryptjs"
import { generateOTP, isOTPExpired } from "../utils/otp"
import { sendOTPEmail } from "../utils/email"
import { generateToken } from "../utils/jwt"

const router = express.Router()

// Sign Up - Send OTP
router.post("/send-otp", async (req: Request, res: Response) => {
  try {
    const { email, name, password } = req.body

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      })
    }

    // Generate OTP
    const otp = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Send OTP email
    await sendOTPEmail(email, otp)

    // Check if user exists
    let user = await User.findOne({ email })
    if (user) {
      // If user already verified, disallow duplicate signup
      if (user.verified) {
        return res.status(400).json({ success: false, message: "User already exists. Please sign in." })
      }

      // Update unverified user: optionally update name and password, then set OTP
      if (name) user.name = name
      if (password) user.password = await bcrypt.hash(password, 10)
      user.otp = { code: otp, expiresAt }
      await user.save()
    } else {
      // Create new user with OTP; password is required for signup
      const hashed = password ? await bcrypt.hash(password, 10) : undefined
      user = await User.create({
        email,
        name: name || email.split("@")[0],
        password: hashed,
        otp: { code: otp, expiresAt },
      })
    }

    res.status(200).json({
      success: true,
      message: "OTP sent to email successfully",
      email,
    })
  } catch (error: any) {
    console.error("Error sending OTP:", error)
    res.status(500).json({
      success: false,
      message: error.message || "Failed to send OTP",
    })
  }
})

// Verify OTP & Sign Up
router.post("/verify-otp", async (req: Request, res: Response) => {
  try {
    const { email, otp, name } = req.body

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }

    // Check if OTP exists and is valid
    if (!user.otp || !user.otp.code) {
      return res.status(400).json({
        success: false,
        message: "OTP not sent. Please request a new one",
      })
    }

    if (isOTPExpired(user.otp.expiresAt)) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      })
    }

    if (user.otp.code !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      })
    }

    // Mark user as verified
    user.verified = true
    user.verifiedAt = new Date()
    if (name) user.name = name
    user.otp = { code: "", expiresAt: new Date() }
    await user.save()

    // Generate JWT token
    const token = generateToken(user._id.toString())

    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: !!user.isAdmin,
      },
    })
  } catch (error: any) {
    console.error("Error verifying OTP:", error)
    res.status(500).json({
      success: false,
      message: error.message || "Failed to verify OTP",
    })
  }
})

// Sign In using email + password
router.post("/sign-in", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" })
    }

    if (!user.verified) {
      return res.status(403).json({ success: false, message: "Account not verified. Please complete signup verification." })
    }

    if (!user.password) {
      return res.status(400).json({ success: false, message: "No password set for this account" })
    }

    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid credentials" })
    }

    const token = generateToken(user._id.toString())
    user.lastLogin = new Date()
    await user.save()

    res.status(200).json({
      success: true,
      message: "Signed in successfully",
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: !!user.isAdmin,
      },
    })
  } catch (error: any) {
    console.error("Error signing in:", error)
    res.status(500).json({ success: false, message: error.message || "Failed to sign in" })
  }
})

// Verify Token (Check if logged in)
router.get("/verify-token", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      })
    }

    const token = authHeader.substring(7)
    const { verifyToken } = await import("../utils/jwt")
    const decoded = verifyToken(token)

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      })
    }

    const user = await User.findById(decoded.userId)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      })
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: !!user.isAdmin,
      },
    })
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})



export default router
