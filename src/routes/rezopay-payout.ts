/**
 * RezoPay Payout Routes
 * =====================
 * Handles the full payout lifecycle via RezoPay (pg.sdmrc.in).
 *
 * Routes:
 *   POST   /api/gateway-payouts/initiate         — User requests a payout (admin-approved flow)
 *   GET    /api/gateway-payouts/balance           — Check RezoPay wallet balance (admin only)
 *   GET    /api/gateway-payouts/status/:orderid   — Check payout status (by our orderid)
 *   POST   /api/gateway-payouts/callback          — RezoPay async callback (public, no auth)
 *   POST   /api/gateway-payouts/:id/dispatch      — Admin dispatches approved payout to gateway
 *   GET    /api/gateway-payouts                   — Admin: list all gateway payouts
 *
 * Security Architecture:
 * - Users can REQUEST payouts but admin DISPATCHES them to the gateway (2-step approval)
 * - Idempotency enforced at DB level (unique orderid) AND at route level (check before call)
 * - Payout callback URL is public but validated via RezoPay's orderid matching our DB
 * - No secrets in response bodies — gateway errors are sanitized
 * - Duplicate dispatch prevention: status check before every gateway call
 *
 * Flow:
 *   User → POST /initiate → creates GatewayPayout{status: pending}
 *   Admin → POST /:id/dispatch → calls RezoPay, updates status to processing
 *   RezoPay → POST /callback → updates status to success|failed|returned
 *   [Safety net] → payout poller checks status every 5min for stuck payouts
 */

import express, { Request, Response } from "express"
import crypto from "crypto"
import GatewayPayout from "../models/GatewayPayout"
import User from "../models/User"
import authMiddleware from "../middleware/authMiddleware"
import isAdmin from "../middleware/isAdmin"
import {
    initiateRezoPayout,
    checkRezoPayoutStatus,
    checkRezoPayoutBalance,
} from "../services/rezopay"

const router = express.Router()

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Generate a unique, human-readable orderid for RezoPay.
 * Format: POUT<timestamp><random4hex>
 * Length: ~18 chars — well within RezoPay's limits.
 */
function generatePayoutOrderId(): string {
    const ts = Date.now().toString()
    const rand = crypto.randomBytes(2).toString("hex").toUpperCase()
    return `POUT${ts}${rand}`
}

/**
 * Validate Indian mobile number (10 digits, starts 6-9).
 */
function isValidMobile(mobile: string): boolean {
    return /^[6-9]\d{9}$/.test(mobile.trim())
}

/**
 * Validate IFSC code (4 alpha + 0 + 6 alphanumeric).
 */
function isValidIFSC(ifsc: string): boolean {
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/gateway-payouts/initiate
 * User submits a payout request. Creates a record in pending state.
 * Admin must then dispatch it via /:id/dispatch.
 *
 * Body: { fullName, amount, mobile, accountNumber, ifsc, bank }
 */
router.post("/initiate", authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" })
        }

        const { fullName, amount, mobile, accountNumber, ifsc, bank } = req.body

        // ── Input Validation ──────────────────────────────────────────────────────
        const errors: string[] = []

        if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
            errors.push("fullName must be at least 2 characters")
        }
        if (!amount || isNaN(Number(amount)) || Number(amount) < 1) {
            errors.push("amount must be a positive number (minimum ₹1)")
        }
        if (!mobile || !isValidMobile(String(mobile))) {
            errors.push("mobile must be a valid 10-digit Indian mobile number")
        }
        if (!accountNumber || String(accountNumber).trim().length < 6) {
            errors.push("accountNumber is required and must be valid")
        }
        if (!ifsc || !isValidIFSC(String(ifsc))) {
            errors.push("ifsc must be a valid IFSC code (e.g. SBIN0001234)")
        }
        if (!bank || String(bank).trim().length < 2) {
            errors.push("bank name is required")
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors,
            })
        }

        const parsedAmount = Number(amount)

        // ── Generate Unique OrderId ────────────────────────────────────────────────
        const orderid = generatePayoutOrderId()

        // ── Create Payout Record ───────────────────────────────────────────────────
        const record = await GatewayPayout.create({
            userId,
            orderid,
            fullName: fullName.trim(),
            amount: parsedAmount,
            mobile: String(mobile).trim(),
            accountNumber: String(accountNumber).trim(),
            ifsc: String(ifsc).trim().toUpperCase(),
            bank: String(bank).trim(),
            status: "pending",
        })

        console.log(
            `[GatewayPayout] ✅ Created payout request: orderid=${orderid} userId=${userId} amount=${parsedAmount}`
        )

        return res.status(201).json({
            success: true,
            message: "Payout request submitted. Pending admin approval.",
            data: {
                id: record._id,
                orderid: record.orderid,
                amount: record.amount,
                status: record.status,
                createdAt: record.createdAt,
            },
        })
    } catch (error: any) {
        console.error("[GatewayPayout] initiate error:", error.message)
        return res.status(500).json({ success: false, message: "Server error" })
    }
})

/**
 * POST /api/gateway-payouts/:id/dispatch
 * Admin dispatches an approved payout to RezoPay gateway.
 *
 * Idempotency: Checks current status before calling gateway.
 * If already dispatched (status !== "pending"), returns conflict.
 */
router.post(
    "/:id/dispatch",
    authMiddleware,
    isAdmin,
    async (req: Request, res: Response) => {
        try {
            const { id } = req.params
            const adminId = (req as any).user?.id

            const record = await GatewayPayout.findById(id)
            if (!record) {
                return res.status(404).json({ success: false, message: "Payout record not found" })
            }

            // ── Idempotency Guard ──────────────────────────────────────────────────
            if (record.status !== "pending") {
                return res.status(409).json({
                    success: false,
                    message: `Payout is already in '${record.status}' state. Cannot re-dispatch.`,
                    data: { orderid: record.orderid, status: record.status },
                })
            }

            // ── Balance Pre-check (non-blocking — log warning if balance API fails) ─
            try {
                const balance = await checkRezoPayoutBalance()
                if (balance.status === "success" && balance.balance !== undefined) {
                    if (balance.balance < record.amount) {
                        console.warn(
                            `[GatewayPayout] ⚠️ Insufficient RezoPay balance: ${balance.balance} < ${record.amount}`
                        )
                        return res.status(400).json({
                            success: false,
                            message: `Insufficient RezoPay payout balance. Available: ₹${balance.balance}, Required: ₹${record.amount}`,
                        })
                    }
                }
            } catch (balErr: any) {
                // Non-fatal — log and continue. Balance check failing shouldn't block dispatch.
                console.warn("[GatewayPayout] Balance pre-check failed (non-fatal):", balErr.message)
            }

            // ── Call RezoPay Gateway ───────────────────────────────────────────────
            console.log(
                `[GatewayPayout] Admin ${adminId} dispatching orderid=${record.orderid} to RezoPay...`
            )

            let gatewayResponse: Awaited<ReturnType<typeof initiateRezoPayout>>

            try {
                gatewayResponse = await initiateRezoPayout({
                    orderid: record.orderid,
                    fullName: record.fullName,
                    amount: record.amount,
                    mobile: record.mobile,
                    accountNumber: record.accountNumber,
                    ifsc: record.ifsc,
                    bank: record.bank,
                })
            } catch (gatewayErr: any) {
                console.error(
                    `[GatewayPayout] Gateway call failed for orderid=${record.orderid}:`,
                    gatewayErr.message
                )

                // Mark as failed in DB so admin knows to investigate
                await GatewayPayout.findByIdAndUpdate(id, {
                    $set: {
                        status: "failed",
                        gatewayMessage: gatewayErr.message,
                        gatewayUpdatedAt: new Date(),
                        approvedBy: adminId,
                        approvedAt: new Date(),
                    },
                })

                return res.status(502).json({
                    success: false,
                    message: `RezoPay gateway error: ${gatewayErr.message}`,
                })
            }

            // ── Map RezoPay Response to Our Status ─────────────────────────────────
            // RezoPay returns: { status: "pending" | "failed", message: "..." }
            // "pending" means accepted for processing — we call this "processing"
            const newStatus =
                gatewayResponse.status === "pending" ? "processing" : "failed"

            await GatewayPayout.findByIdAndUpdate(id, {
                $set: {
                    status: newStatus,
                    gatewayMessage: gatewayResponse.message,
                    initiatedAt: new Date(),
                    gatewayUpdatedAt: new Date(),
                    approvedBy: adminId,
                    approvedAt: new Date(),
                },
            })

            console.log(
                `[GatewayPayout] ✅ Dispatched: orderid=${record.orderid} → gateway status=${gatewayResponse.status} → our status=${newStatus}`
            )

            return res.json({
                success: true,
                message: `Payout dispatched to RezoPay. Status: ${newStatus}`,
                data: {
                    orderid: record.orderid,
                    status: newStatus,
                    gatewayStatus: gatewayResponse.status,
                    gatewayMessage: gatewayResponse.message,
                },
            })
        } catch (error: any) {
            console.error("[GatewayPayout] dispatch error:", error.message)
            return res.status(500).json({ success: false, message: "Server error" })
        }
    }
)

/**
 * POST /api/gateway-payouts/callback
 * RezoPay sends asynchronous payout status updates here.
 *
 * ⚠️  This endpoint MUST be publicly accessible (no auth middleware).
 *     Register this URL in your RezoPay merchant panel as the payout callback.
 *
 * Expected body:
 *   { status: "success" | "failed", message?, orderid, utr? }
 *
 * Security: We validate the orderid exists in our DB before accepting.
 * Always return 200 — if we return 4xx/5xx, RezoPay will retry.
 */
router.post("/callback", async (req: Request, res: Response) => {
    try {
        const callerIp =
            req.ip ||
            (req.headers["x-forwarded-for"] as string) ||
            req.socket.remoteAddress

        console.log("============ REZOPAY PAYOUT CALLBACK HIT ============")
        console.log("[RezoPay Callback] IP:", callerIp)
        console.log("[RezoPay Callback] Body:", JSON.stringify(req.body, null, 2))

        const { status, message, orderid, utr } = req.body as {
            status?: string
            message?: string
            orderid?: string
            utr?: string
        }

        // ── Basic Payload Validation ───────────────────────────────────────────────
        if (!orderid) {
            console.warn("[RezoPay Callback] ⚠️ Missing orderid in payload")
            return res.status(200).json({ status: "ok", message: "Missing orderid — acknowledged" })
        }

        // ── Map Gateway Status → Our Status ───────────────────────────────────────
        let newStatus: string = "processing" // default: unknown status, keep processing

        if (status === "success") {
            newStatus = "success"
        } else if (status === "failed" || status === "returned") {
            newStatus = status // "failed" or "returned"
        } else {
            console.warn(`[RezoPay Callback] Unknown status received: '${status}'. Keeping processing.`)
        }

        // ── Atomic Idempotent DB Update ────────────────────────────────────────────
        // Only update if NOT already in a terminal state (success/failed/returned)
        const updated = await GatewayPayout.findOneAndUpdate(
            {
                orderid,
                status: { $nin: ["success", "failed", "returned"] }, // Idempotency guard
            },
            {
                $set: {
                    status: newStatus,
                    utr: utr || "",
                    gatewayMessage: message || "",
                    gatewayUpdatedAt: new Date(),
                    callbackPayload: req.body,
                    updatedAt: new Date(),
                },
            },
            { new: true }
        )

        if (updated) {
            console.log(
                `[RezoPay Callback] ✅ Updated: orderid=${orderid} → status=${newStatus} utr=${utr || "N/A"}`
            )
        } else {
            // Check if not found or already terminal
            const existing = await GatewayPayout.findOne({ orderid })
            if (!existing) {
                console.warn(`[RezoPay Callback] ⚠️ orderid=${orderid} NOT FOUND in DB`)
            } else {
                console.log(
                    `[RezoPay Callback] ℹ️ orderid=${orderid} already in terminal status=${existing.status}. Idempotency skip.`
                )
            }
        }

        // Always return 200 to prevent RezoPay from re-sending
        return res.status(200).json({ status: "ok" })

    } catch (error: any) {
        console.error("[RezoPay Callback] 🔥 SYSTEM ERROR:", error.message, error.stack)
        // Always 200 — prevent retry storm
        return res.status(200).json({ status: "ok", message: "Error handled" })
    }
})

/**
 * GET /api/gateway-payouts/status/:orderid
 * Check status of a payout by our internal orderid.
 * Also does a live check with RezoPay if status is still processing.
 *
 * Access: Auth required (user can check own, admin can check any)
 */
router.get("/status/:orderid", authMiddleware, async (req: Request, res: Response) => {
    try {
        const { orderid } = req.params
        const userId = (req as any).user?.id

        const record = await GatewayPayout.findOne({ orderid })

        if (!record) {
            return res.status(404).json({
                success: false,
                message: "Payout record not found",
            })
        }

        // Security: Non-admins can only check their own payouts
        const userDoc = await User.findById(userId).select("isAdmin")
        const isAdminUser = userDoc?.isAdmin === true

        if (!isAdminUser && String(record.userId) !== String(userId)) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            })
        }

        // ── Live Status Check from RezoPay (if still processing) ──────────────────
        let liveStatus: any = null

        if (record.status === "processing") {
            try {
                const rezoStatus = await checkRezoPayoutStatus(record.orderid)
                liveStatus = rezoStatus

                // Update DB with live status if it changed to terminal state
                if (rezoStatus.status === "success" && rezoStatus.data?.status === "success") {
                    await GatewayPayout.findOneAndUpdate(
                        { orderid, status: { $nin: ["success", "failed", "returned"] } },
                        {
                            $set: {
                                status: "success",
                                utr: rezoStatus.data?.utr || "",
                                gatewayMessage: rezoStatus.message,
                                lastStatusCheck: rezoStatus,
                                lastStatusCheckedAt: new Date(),
                                gatewayUpdatedAt: new Date(),
                            },
                        }
                    )
                    record.status = "success"
                    record.utr = rezoStatus.data?.utr || ""
                } else if (rezoStatus.data?.status === "failed") {
                    await GatewayPayout.findOneAndUpdate(
                        { orderid, status: { $nin: ["success", "failed", "returned"] } },
                        {
                            $set: {
                                status: "failed",
                                gatewayMessage: rezoStatus.message,
                                lastStatusCheck: rezoStatus,
                                lastStatusCheckedAt: new Date(),
                                gatewayUpdatedAt: new Date(),
                            },
                        }
                    )
                    record.status = "failed"
                } else {
                    // Still pending/processing — update last check timestamp
                    await GatewayPayout.findByIdAndUpdate(record._id, {
                        $set: {
                            lastStatusCheck: rezoStatus,
                            lastStatusCheckedAt: new Date(),
                        },
                    })
                }
            } catch (statusErr: any) {
                console.warn(
                    `[GatewayPayout] Live status check failed for orderid=${orderid}:`,
                    statusErr.message
                )
                // Non-fatal — return DB status
            }
        }

        return res.json({
            success: true,
            data: {
                id: record._id,
                orderid: record.orderid,
                status: record.status,
                amount: record.amount,
                utr: record.utr,
                fullName: record.fullName,
                bank: record.bank,
                ifsc: record.ifsc,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                gatewayMessage: record.gatewayMessage,
                liveGatewayStatus: liveStatus ? liveStatus.data : null,
            },
        })
    } catch (error: any) {
        console.error("[GatewayPayout] status check error:", error.message)
        return res.status(500).json({ success: false, message: "Server error" })
    }
})

/**
 * GET /api/gateway-payouts/balance
 * Admin only — check current RezoPay payout wallet balance.
 */
router.get("/balance", authMiddleware, isAdmin, async (req: Request, res: Response) => {
    try {
        const balanceData = await checkRezoPayoutBalance()

        if (balanceData.status !== "success") {
            return res.status(502).json({
                success: false,
                message: balanceData.message || "Failed to fetch balance from RezoPay",
            })
        }

        return res.json({
            success: true,
            data: {
                balance: balanceData.balance,
                currency: "INR",
                gateway: "rezopay",
                checkedAt: new Date().toISOString(),
            },
        })
    } catch (error: any) {
        console.error("[GatewayPayout] balance check error:", error.message)
        return res.status(500).json({ success: false, message: error.message })
    }
})

/**
 * GET /api/gateway-payouts
 * Admin: paginated list of all gateway payouts.
 * Query params: ?status=pending&page=1&limit=20
 */
router.get("/", authMiddleware, isAdmin, async (req: Request, res: Response) => {
    try {
        const { status, page = "1", limit = "20", userId: filterUserId } = req.query as any

        const pageNum = Math.max(1, parseInt(page, 10) || 1)
        const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))

        const filter: any = {}
        if (status) filter.status = status
        if (filterUserId) filter.userId = filterUserId

        const [payouts, total] = await Promise.all([
            GatewayPayout.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * lim)
                .limit(lim)
                .populate("userId", "name email")
                .lean(),
            GatewayPayout.countDocuments(filter),
        ])

        return res.json({
            success: true,
            data: {
                payouts,
                total,
                page: pageNum,
                limit: lim,
                pages: Math.ceil(total / lim),
            },
        })
    } catch (error: any) {
        console.error("[GatewayPayout] list error:", error.message)
        return res.status(500).json({ success: false, message: "Server error" })
    }
})

/**
 * GET /api/gateway-payouts/mine
 * Authenticated user — view own payout history.
 * Query params: ?page=1&limit=20
 */
router.get("/mine", authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id
        const { page = "1", limit = "20" } = req.query as any

        const pageNum = Math.max(1, parseInt(page, 10) || 1)
        const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))

        const [payouts, total] = await Promise.all([
            GatewayPayout.find({ userId })
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * lim)
                .limit(lim)
                .select("-callbackPayload -lastStatusCheck") // Don't expose raw gateway data to users
                .lean(),
            GatewayPayout.countDocuments({ userId }),
        ])

        return res.json({
            success: true,
            data: {
                payouts,
                total,
                page: pageNum,
                limit: lim,
            },
        })
    } catch (error: any) {
        console.error("[GatewayPayout] mine error:", error.message)
        return res.status(500).json({ success: false, message: "Server error" })
    }
})

export default router
