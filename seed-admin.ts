import dotenv from 'dotenv'
dotenv.config()

import { connectDB } from './src/config/database'
import User from './src/models/User'

async function seedAdmin() {
  try {
    await connectDB()

    const adminEmail = 'admin@codecaffeine.in'
    let user = await User.findOne({ email: adminEmail })

    if (!user) {
      console.log('Admin user not found, creating...')
      user = await User.create({
        email: adminEmail,
        name: 'Admin',
        password: await require('bcryptjs').hash('adminpassword', 10), // Set a default password or change as needed
        verified: true,
        isVerified: true,
        isAdmin: true,
        verifiedAt: new Date(),
      })
      console.log('Admin user created')
    } else {
      console.log('Updating admin user...')
      user.verified = true
      user.isVerified = true
      user.isAdmin = true
      if (!user.verifiedAt) user.verifiedAt = new Date()
      await user.save()
      console.log('Admin user updated')
    }

    console.log('Admin user details:', {
      email: user.email,
      verified: user.verified,
      isVerified: user.isVerified,
      isAdmin: user.isAdmin,
    })
  } catch (error) {
    console.error('Error seeding admin:', error)
  } finally {
    process.exit(0)
  }
}

seedAdmin()