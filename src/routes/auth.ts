
import express, { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User";
import { sendResetPasswordEmail, sendOTPEmail } from "../utils/email";
import { generateToken, verifyToken } from "../utils/jwt";
import { generateOTP, isOTPExpired } from "../utils/otp";
const router = express.Router();


// Request password reset link
router.post("/request-reset-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    // Generate token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 min
    user.resetPassword = { token, expires };
    await user.save();
    await sendResetPasswordEmail(email, token);
    res.json({ success: true, message: "Reset link sent to email" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to send reset link" });
  }
});

// Reset password using token
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, message: "Token and password required" });
    const user = await User.findOne({ "resetPassword.token": token });
    if (!user || !user.resetPassword || user.resetPassword.token !== token) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }
    if (user.resetPassword.expires < new Date()) {
      return res.status(400).json({ success: false, message: "Token expired" });
    }
    user.password = await bcrypt.hash(password, 10);
    user.resetPassword = undefined;
    await user.save();
    res.json({ success: true, message: "Password reset successful" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || "Failed to reset password" });
  }
});


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

    // Mark email as verified (OTP verification), but user still needs admin verification
    // DO NOT set isVerified - that's for admin verification only
    // verified field is for email/OTP verification
    user.verified = true
    // Do NOT set verifiedAt here - that's for admin verification
    if (name) user.name = name
    user.otp = { code: "", expiresAt: new Date() }
    await user.save()

    // DO NOT generate token or allow login - user must wait for admin verification
    // User can only login after admin verifies them (isVerified = true)

    res.status(200).json({
      success: true,
      message: "Email verified successfully. Your account is pending admin verification. You will be notified once your account is approved.",
      // NO token - user cannot login until admin verifies
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isAdmin: !!user.isAdmin,
        isVerified: false, // Admin verification pending
        verified: true, // Email verified
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

    // Check email verification (OTP verification) - must be true
    // EXCEPTION: Admins can login regardless of verification status
    if (!user.verified && !user.isAdmin) {
      return res.status(403).json({ success: false, message: "Email not verified. Please complete signup verification." })
    }

    // CRITICAL: Check admin verification - user CANNOT login until admin verifies
    // verified = email/OTP verification (must be true)
    // isVerified = admin verification (must be true to login)
    // EXCEPTION: Admins can login regardless of isVerified status
    if (!user.isVerified && !user.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: "Your account is pending admin verification. Please wait for approval or contact support." 
      })
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
