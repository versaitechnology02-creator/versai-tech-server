import express, { Request, Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User";
import { sendResetPasswordEmail, sendOTPEmail } from "../utils/email";
import { generateToken } from "../utils/jwt";
import { generateOTP, isOTPExpired } from "../utils/otp";

const router = express.Router();

/**
 * Normalize email (CRITICAL for production)
 */
const normalizeEmail = (email: string) =>
  email.toLowerCase().trim();

/* =========================
   REQUEST RESET PASSWORD
========================= */
router.post("/request-reset-password", async (req: Request, res: Response) => {
  try {
    if (!req.body.email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const email = normalizeEmail(req.body.email);

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 30 * 60 * 1000);

    user.resetPassword = { token, expires };
    await user.save();

    await sendResetPasswordEmail(email, token);

    return res.json({ success: true, message: "Reset link sent to email" });
  } catch (error: any) {
    console.error("RESET PASSWORD ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   RESET PASSWORD
========================= */
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, message: "Token and password required" });
    }

    const user = await User.findOne({ "resetPassword.token": token });
    if (!user || !user.resetPassword) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }

    if (user.resetPassword.expires < new Date()) {
      return res.status(400).json({ success: false, message: "Token expired" });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPassword = undefined;
    await user.save();

    return res.json({ success: true, message: "Password reset successful" });
  } catch (error: any) {
    console.error("RESET PASSWORD CONFIRM ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   SEND OTP
========================= */
router.post("/send-otp", async (req: Request, res: Response) => {
  try {
    if (!req.body.email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const email = normalizeEmail(req.body.email);
    const { name, password } = req.body;

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await sendOTPEmail(email, otp);

    let user = await User.findOne({ email });

    if (user) {
      if (user.verified) {
        return res.status(400).json({ success: false, message: "User already exists. Please sign in." });
      }

      if (name) user.name = name;
      if (password) user.password = await bcrypt.hash(password, 10);
      user.otp = { code: otp, expiresAt };
      await user.save();
    } else {
      const hashed = password ? await bcrypt.hash(password, 10) : undefined;
      user = await User.create({
        email,
        name: name || email.split("@")[0],
        password: hashed,
        otp: { code: otp, expiresAt },
        isAdmin: false,
      });
    }

    return res.json({ success: true, message: "OTP sent successfully", email });
  } catch (error: any) {
    console.error("SEND OTP ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   VERIFY OTP
========================= */
router.post("/verify-otp", async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { otp, name } = req.body;

    const user = await User.findOne({ email });
    if (!user || !user.otp) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (isOTPExpired(user.otp.expiresAt)) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    if (user.otp.code !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    user.verified = true;
    if (name) user.name = name;
    user.otp = { code: "", expiresAt: new Date() };
    await user.save();

    return res.json({
      success: true,
      message: "Email verified. Awaiting admin approval.",
    });
  } catch (error: any) {
    console.error("VERIFY OTP ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   SIGN IN
========================= */
router.post("/sign-in", async (req: Request, res: Response) => {
  try {
    const { email: rawEmail, password } = req.body;

    console.log(`[LOGIN DEBUG] Login attempt for email: ${rawEmail}`);

    if (!rawEmail || !password) {
      console.log(`[LOGIN DEBUG] Missing credentials for: ${rawEmail}`);
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const email = normalizeEmail(rawEmail);
    console.log(`[LOGIN DEBUG] Normalized email: ${email}`);

    // Check database connection state (0 = disconnected, 1 = connected)
    console.log(`[LOGIN DEBUG] Mongoose Connection State: ${mongoose.connection.readyState}`);

    const user = await User.findOne({ email });

    if (!user) {
      console.log(`[LOGIN DEBUG] User not found for email: ${email}`);
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log(`[LOGIN DEBUG] User found: ${user._id}`);
    console.log(`[LOGIN DEBUG] User status: verified=${user.verified}, isVerified=${user.isVerified}, isAdmin=${user.isAdmin}, hasPassword=${!!user.password}`);

    // Check verification status
    if (!user.verified && !user.isAdmin) {
      console.log(`[LOGIN DEBUG] User not verified (legacy flag)`);
      return res.status(403).json({ success: false, message: "Email not verified" });
    }

    if (!user.isVerified && !user.isAdmin) {
      console.log(`[LOGIN DEBUG] User not approved by admin`);
      return res.status(403).json({ success: false, message: "Pending admin verification" });
    }

    if (!user.password) {
      console.error("[LOGIN DEBUG] CRITICAL: User exists but has no password set", {
        id: user._id,
        email: user.email
      });
      return res.status(401).json({ success: false, message: "Invalid credentials (no password set)" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      console.log(`[LOGIN DEBUG] Password mismatch for user: ${email}`);
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    console.log(`[LOGIN DEBUG] Password match successful. Generating token...`);
    const token = generateToken(user._id.toString());

    user.lastLogin = new Date();
    await user.save();

    // Return token and safe user fields for the client
    // CRITICAL: Ensure no fields are undefined, as JSON.stringify might strip them
    const safeUser = {
      id: user._id ? user._id.toString() : 'unknown',
      email: user.email || '',
      name: user.name || '',
      isAdmin: !!user.isAdmin,
      verified: !!user.verified,
      isVerified: !!user.isVerified,
      lastLogin: user.lastLogin || new Date(),
      role: user.isAdmin ? 'admin' : 'user'
    };

    console.log(`[LOGIN DEBUG] Sending successful response with user object:`, JSON.stringify(safeUser));

    // Explicit return to ensure express sends it
    return res.status(200).json({
      success: true,
      token,
      user: safeUser
    });

  } catch (error: any) {
    console.error("[LOGIN DEBUG] SIGN IN ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   DEBUG ENDPOINT (Verify Deployment)
   GET /api/auth/debug-version
========================= */
router.get("/debug-version", (req, res) => {
  res.json({
    success: true,
    version: "1.2.0",
    timestamp: new Date().toISOString(),
    message: "Login Response Fix Applied (User Object Included)"
  });
});

export default router;