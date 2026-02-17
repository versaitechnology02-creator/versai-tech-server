import dotenv from "dotenv"
dotenv.config()
import nodemailer from "nodemailer"

async function testEmail() {
    console.log("-----------------------------------------")
    console.log("Testing Email Sending from Production Env")
    console.log("-----------------------------------------")

    const { EMAIL_SERVICE, EMAIL_USER, EMAIL_PASSWORD, EMAIL_HOST, EMAIL_PORT } = process.env

    console.log("Config:", {
        EMAIL_SERVICE,
        EMAIL_USER,
        EMAIL_HOST,
        EMAIL_PORT,
        PASS_LEN: EMAIL_PASSWORD ? EMAIL_PASSWORD.length : 0
    })

    if (!EMAIL_USER || !EMAIL_PASSWORD) {
        console.error("❌ ERROR: EMAIL_USER or EMAIL_PASSWORD missing in .env")
        return
    }

    try {
        const transporter = nodemailer.createTransport({
            service: EMAIL_SERVICE || undefined,
            host: EMAIL_HOST || "smtp.gmail.com",
            port: Number(EMAIL_PORT) || 587,
            secure: false, // true for 465, false for other ports
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASSWORD,
            },
            logger: true, // log to console
            debug: true   // include SMTP traffic in logs
        })

        console.log("Attempting to verify connection...")
        await transporter.verify()
        console.log("✅ Connection Verified!")

        console.log("Attempting to send test email...")
        const info = await transporter.sendMail({
            from: `"Test Script" <${EMAIL_USER}>`,
            to: EMAIL_USER, // Send to self
            subject: "Test Email from Versai Server",
            text: "If you received this, your email configuration is working correctly!",
        })

        console.log("✅ Email Sent Successfully!")
        console.log("Message ID:", info.messageId)
    } catch (error: any) {
        console.error("❌ FAILED to send email:")
        console.error(error.message)
        if (error.code === 'EAUTH') {
            console.error("👉 Check your Email and App Password.")
            console.error("👉 If using Gmail, ensure 2FA is on and use an App Password.")
        }
    }
}

testEmail()
