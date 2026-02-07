import nodemailer from "nodemailer";

const {
  EMAIL_SERVICE,
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_SECURE,
  EMAIL_USER,
  EMAIL_PASSWORD,
  EMAIL_FROM,
} = process.env;

// Singleton transporter promise (SAFE for concurrent requests)
let transporterPromise: Promise<nodemailer.Transporter> | null = null;
let usingEthereal = false;

/**
 * Create nodemailer transporter (runs only once)
 */
async function createTransporter(): Promise<nodemailer.Transporter> {
  // Production / real SMTP
  if (EMAIL_SERVICE || EMAIL_HOST) {
    const port = EMAIL_PORT ? parseInt(EMAIL_PORT, 10) : undefined;
    const secure = EMAIL_SECURE
      ? EMAIL_SECURE === "true"
      : port === 465;

    return nodemailer.createTransport({
      service: EMAIL_SERVICE || undefined,
      host: EMAIL_HOST || undefined,
      port,
      secure,
      auth: EMAIL_USER
        ? {
            user: EMAIL_USER,
            pass: EMAIL_PASSWORD,
          }
        : undefined,
    });
  }

  // Development fallback (Ethereal)
  usingEthereal = true;
  console.info(
    "No SMTP config found — using Ethereal test account (DEV only)"
  );

  const testAccount = await nodemailer.createTestAccount();

  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

/**
 * Get transporter (singleton)
 */
function getTransporter(): Promise<nodemailer.Transporter> {
  if (!transporterPromise) {
    transporterPromise = createTransporter();
  }
  return transporterPromise;
}

/**
 * Send Reset Password Email
 */
export async function sendResetPasswordEmail(
  email: string,
  token: string
) {
  try {
    const transporter = await getTransporter();

    const resetUrl = `${
      process.env.CLIENT_URL || "https://payments.versaitechnology.com"
    }/auth/reset-password-confirm?token=${token}`;

    const info = await transporter.sendMail({
      from: EMAIL_FROM || "Versai Tech <no-reply@localhost>",
      to: email,
      subject: "Reset your Versai Tech password",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Versai Tech Password Reset</h2>
          <p>Click the link below to reset your password. This link will expire in 30 minutes.</p>
          <div style="margin: 20px 0;">
            <a href="${resetUrl}"
               style="background: #007bff; color: #fff; padding: 12px 24px;
               border-radius: 6px; text-decoration: none;">
               Reset Password
            </a>
          </div>
          <p style="color: #999; font-size: 12px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    });

    if (usingEthereal) {
      console.info(
        "Ethereal reset password preview:",
        nodemailer.getTestMessageUrl(info)
      );
    }

    return info;
  } catch (error: any) {
    console.error("Error sending reset password email:", error);
    throw error;
  }
}

/**
 * Send OTP Email
 */
export async function sendOTPEmail(email: string, otp: string) {
  try {
    const transporter = await getTransporter();

    const info = await transporter.sendMail({
      from: EMAIL_FROM || "Versai Tech <no-reply@localhost>",
      to: email,
      subject: "Your Versai Tech OTP Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Versai Tech Verification</h2>
          <p>Your One-Time Password (OTP) is:</p>
          <div style="background-color: #f0f0f0; padding: 20px;
            border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="letter-spacing: 5px; color: #007bff; margin: 0;">
              ${otp}
            </h1>
          </div>
          <p style="color: #666;">This OTP will expire in 10 minutes.</p>
          <p style="color: #999; font-size: 12px;">
            If you didn't request this, please ignore this email.
          </p>
        </div>
      `,
    });

    if (usingEthereal) {
      console.info(
        "Ethereal OTP preview:",
        nodemailer.getTestMessageUrl(info)
      );
    }

    return info;
  } catch (error: any) {
    console.error("Error sending OTP email:", error);
    throw error;
  }
}