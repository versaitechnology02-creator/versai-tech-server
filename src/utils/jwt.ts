import jwt from "jsonwebtoken"

export function generateToken(userId: string): string {
  return (jwt as any).sign({ userId }, process.env.JWT_SECRET || "secret", {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  })
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return (jwt as any).verify(token, process.env.JWT_SECRET || "secret") as { userId: string }
  } catch (error) {
    return null
  }
}
