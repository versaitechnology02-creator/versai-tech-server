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
        const authHeader = req.headers.authorization || ""
        const xKey = req.headers['x-api-key']

        if (!authHeader && !xKey) {
            return res.status(401).json({
                success: false,
                message: "Authorization missing. Use 'Authorization: Bearer <key>' or 'x-api-key' header.",
            })
        }

        let rawToken = ""
        let isForcedApiKey = false

        if (xKey) {
            rawToken = String(xKey)
            isForcedApiKey = true
        } else if (authHeader.toLowerCase().startsWith("bearer ")) {
            rawToken = authHeader.split(/\s+/)[1] || ""
        } else {
            rawToken = authHeader // Fallback for raw token in Authorization header
        }

        // Clean token - remove any quotes, colons, or whitespace that might be copy-pasted accidentally
        const token = rawToken.replace(/['":;]/g, "").trim()

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "API key or token is empty.",
            })
        }

        // ── Detect token type ─────────────────────────────────────────────────────
        const isJwt = !isForcedApiKey && (token.startsWith("eyJ") || token.split(".").length === 3)

        if (!isJwt) {
            // ── API Key Branch ──────────────────────────────────────────────────────
            const apiKeyRecord = await ApiKey.findOne({ key: token }).lean() as any

            if (!apiKeyRecord) {
                console.warn(`[apiKeyAuth] Invalid Key: ${token.slice(0, 8)}... (len: ${token.length})`)
                return res.status(401).json({
                    success: false,
                    message: `Invalid API key. Check dashboard. (Debug: prefix='${token.slice(0, 8)}', len=${token.length})`,
                })
            }

            if (!apiKeyRecord.isActive) {
                return res.status(401).json({
                    success: false,
                    message: "API key is deactivated.",
                })
            }

            // Check expiry
            if (apiKeyRecord.expiresAt && new Date() > new Date(apiKeyRecord.expiresAt)) {
                return res.status(401).json({
                    success: false,
                    message: "API key has expired.",
                })
            }

            const user = await User.findById(apiKeyRecord.userId).select("_id status").lean() as any
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "API key owner not found.",
                })
            }

            if (user.status === "suspended") {
                return res.status(403).json({
                    success: false,
                    message: "Account suspended.",
                })
            }

            (req as any).user = { id: String(apiKeyRecord.userId) };
            (req as any).userId = String(apiKeyRecord.userId);
            (req as any).apiKeyId = String(apiKeyRecord._id);
            (req as any).authMethod = "api_key";

            // Update lastUsed async
            ApiKey.updateOne({ _id: apiKeyRecord._id }, { $set: { lastUsed: new Date() } }).exec().catch(() => { })

            return next()
        } else {
            // ── JWT Branch ────────────────────────────────────────────────────────────
            const decoded = verifyToken(token)
            if (!decoded || !decoded.userId) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid or expired token.",
                })
            }

            (req as any).user = { id: decoded.userId };
            (req as any).userId = decoded.userId;
            (req as any).authMethod = "jwt";
            return next()
        }
    } catch (error: any) {
        console.error("[apiKeyAuth] Critical Error:", error.message)
        return res.status(401).json({
            success: false,
            message: "Authentication failed",
        })
    }
}
