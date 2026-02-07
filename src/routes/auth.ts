import express, { Request, Response } from "express";
import crypto from "crypto";
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
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.verified && !user.isAdmin) {
      return res.status(403).json({ success: false, message: "Email not verified" });
    }

    if (!user.isVerified && !user.isAdmin) {
      return res.status(403).json({ success: false, message: "Pending admin verification" });
    }

    if (!user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = generateToken(user._id.toString());
    user.lastLogin = new Date();
    await user.save();

    return res.json({ success: true, token });
  } catch (error: any) {
    console.error("SIGN IN ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
