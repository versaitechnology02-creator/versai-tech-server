export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export function isOTPExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt
}
