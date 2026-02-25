/**
 * Unified Auth Middleware — JWT + API Key (Bearer)
 * =================================================
 * Supports two authentication methods:
 *
 * Method 1 — API Key (merchant integrations):
 *   Authorization: Bearer op_live_xxxxxxxxxxxx
 *   The key is looked up in the ApiKey collection. userId is resolved from ApiKey.userId.
 *
 * Method 2 — JWT Token (dashboard/frontend):
 *   Authorization: Bearer eyJhbGci...
 *   Standard JWT decode, userId from payload.
 *
 * Both paths set req.user = { id: userId } so downstream code works identically.
 *
 * This middleware also enforces:
 * - API key must be active (isActive: true)
 * - API key expiry (if expiresAt is set)
 * - Updates lastUsed timestamp on API key (async, non-blocking)
 */

import { Request, Response, NextFunction } from "express"
import ApiKey from "../models/ApiKey"
import User from "../models/User"
import { verifyToken } from "../utils/jwt"

export default async function apiKeyAuth(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const authHeader = req.headers.authorization

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authorization header missing or malformed. Use: Authorization: Bearer <your-api-key>",
            })
        }

        const token = authHeader.slice(7).trim() // Remove "Bearer "

        // ── Detect token type ─────────────────────────────────────────────────────
        // JWT tokens are 3 base64url segments joined by dots and start with "eyJ"
        // API keys are opaque strings (e.g. op_live_xxx, orion_xxx, etc.)
        const looksLikeJwt = token.startsWith("eyJ") || token.split(".").length === 3

        if (!looksLikeJwt) {
            // ── API Key Branch ──────────────────────────────────────────────────────
            const apiKeyRecord = await ApiKey.findOne({ key: token })

            if (!apiKeyRecord) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid API key. Please check your API key in the dashboard.",
                })
            }

            if (!apiKeyRecord.isActive) {
                return res.status(401).json({
                    success: false,
                    message: "API key is deactivated. Please generate a new key from the dashboard.",
                })
            }

            // Check expiry
            if (apiKeyRecord.expiresAt && new Date() > new Date(apiKeyRecord.expiresAt)) {
                return res.status(401).json({
                    success: false,
                    message: "API key has expired. Please generate a new key from the dashboard.",
                })
            }

            // Resolve userId → confirm user still exists and is active
            const user = await User.findById(apiKeyRecord.userId).select("_id status isVerified")

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "API key owner account not found. Please contact support.",
                })
            }

            if ((user as any).status === "suspended") {
                return res.status(403).json({
                    success: false,
                    message: "Your account has been suspended. Contact support.",
                })
            }

            // Attach user to request — same shape as authMiddleware.ts { id }
            ; (req as any).user = { id: String(apiKeyRecord.userId) }
                ; (req as any).userId = String(apiKeyRecord.userId)
                ; (req as any).apiKeyId = String(apiKeyRecord._id)
                ; (req as any).authMethod = "api_key"

            // Update lastUsed asynchronously — don't block the request
            ApiKey.updateOne({ _id: apiKeyRecord._id }, { $set: { lastUsed: new Date() } })
                .exec()
                .catch((err: Error) =>
                    console.warn("[apiKeyAuth] Failed to update lastUsed:", err.message)
                )

            console.log(
                `[apiKeyAuth] ✅ API key auth → userId=${apiKeyRecord.userId} key=${token.slice(0, 15)}...`
            )
            return next()

        } else {
            // ── JWT Branch ────────────────────────────────────────────────────────────
            const decoded = verifyToken(token)

            if (!decoded || !decoded.userId) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid or expired token. Please log in again.",
                })
            }

            ; (req as any).user = { id: decoded.userId }
                ; (req as any).userId = decoded.userId
                ; (req as any).authMethod = "jwt"
            return next()
        }

    } catch (error: any) {
        console.error("[apiKeyAuth] Error:", error.message)
        return res.status(401).json({
            success: false,
            message: "Authentication failed",
        })
    }
}
