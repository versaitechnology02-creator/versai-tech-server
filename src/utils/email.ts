import nodemailer from "nodemailer"

const {
  EMAIL_SERVICE,
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_SECURE,
  EMAIL_USER,
  EMAIL_PASSWORD,
  EMAIL_FROM,
} = process.env

let transporter: nodemailer.Transporter
let usingEthereal = false

async function createTransporter() {

  if (EMAIL_SERVICE || EMAIL_HOST) {
    const host = EMAIL_HOST
    const port = EMAIL_PORT ? parseInt(EMAIL_PORT, 10) : undefined
    const secure = EMAIL_SECURE ? EMAIL_SECURE === "true" : !!(port === 465)

    return nodemailer.createTransport({
      service: EMAIL_SERVICE || undefined,
      host: host || undefined,
      port: port || undefined,
      secure,
      auth: EMAIL_USER
        ? {
            user: EMAIL_USER,
            pass: EMAIL_PASSWORD,
          }
        : undefined,
    })
  }

  // No SMTP config provided — create an Ethereal test account for development
  usingEthereal = true
  console.info("No SMTP configuration found — creating Ethereal test account for development")
  const testAccount = await nodemailer.createTestAccount()
  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  })
}

// Initialize transporter asynchronously but allow send function to await creation
let transporterPromise: Promise<nodemailer.Transporter> | null = null
function getTransporter() {
  if (transporter) return Promise.resolve(transporter)
  if (!transporterPromise) transporterPromise = createTransporter()
  return transporterPromise
}

export async function sendOTPEmail(email: string, otp: string) {
  try {
    const t = await getTransporter()
    transporter = t

    const info = await transporter.sendMail({
      from: EMAIL_FROM || `Versai Tech <no-reply@localhost>`,
      to: email,
      subject: "Your Versai Tech OTP Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Versai Tech Verification</h2>
          <p>Your One-Time Password (OTP) is:</p>
          <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="letter-spacing: 5px; color: #007bff; margin: 0;">${otp}</h1>
          </div>
          <p style="color: #666;">This OTP will expire in 10 minutes.</p>
          <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        </div>
      `,
    })

    // If using Ethereal, log preview URL to console for development
    if (usingEthereal) {
      const preview = nodemailer.getTestMessageUrl(info)
      console.info("Ethereal preview URL:", preview)
    }

    return info
  } catch (error: any) {
    // Give a clearer actionable message for ECONNREFUSED
    if (error && (error.code === "ECONNREFUSED" || error.code === "ESOCKET")) {
      console.error(
        "Error sending OTP email: could not connect to SMTP server. Check your EMAIL_HOST/EMAIL_PORT settings or start a local SMTP server (MailHog/Mailtrap).",
        error,
      )
    } else {
      console.error("Error sending OTP email:", error)
    }
    throw error
  }
}
