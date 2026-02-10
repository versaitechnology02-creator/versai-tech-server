const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios'); // We'll need axios to simulate the request locally

// 1. Load Environment Variables
const envPath = path.resolve(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.error('[TEST] Error loading .env file:', result.error);
    process.exit(1);
}

const normalizeEmail = (email) => email.toLowerCase().trim();

// 2. Define User Schema (Inline for direct DB check)
const userSchema = new mongoose.Schema(
    {
        email: { type: String, required: true },
        password: { type: String, required: false },
        isAdmin: { type: Boolean, default: false },
        verified: { type: Boolean, default: false },
        isVerified: { type: Boolean, default: false },
    },
    { timestamps: true }
);

// Prevent OverwriteModelError
const User = mongoose.models.User || mongoose.model('User', userSchema);

const testLogin = async () => {
    const email = 'admin@versaitech.in';
    const password = 'adminpassword';

    console.log(`[TEST] Starting diagnosis for: ${email}`);

    // A. DIRECT DATABASE CHECK
    try {
        console.log('[TEST] Checking MongoDB directly...');
        await mongoose.connect(process.env.MONGODB_URI);

        const user = await User.findOne({ email: normalizeEmail(email) });

        if (!user) {
            console.error('[TEST] ❌ User NOT FOUND in database!');
        } else {
            console.log(`[TEST] ✅ User found: ${user._id}`);
            console.log(`[TEST]    isAdmin: ${user.isAdmin}`);
            console.log(`[TEST]    verified: ${user.verified}`);
            console.log(`[TEST]    isVerified: ${user.isVerified}`);
            console.log(`[TEST]    Has Password: ${!!user.password}`);

            if (user.password) {
                const match = await bcrypt.compare(password, user.password);
                console.log(`[TEST]    Password Match: ${match ? '✅ YES' : '❌ NO'}`);
            }

            // SIMULATE BACKEND RESPONSE LOGIC
            const safeUser = {
                id: user._id ? user._id.toString() : 'unknown',
                email: user.email || '',
                name: user.name || '',
                isAdmin: !!user.isAdmin,
                verified: !!user.verified,
                isVerified: !!user.isVerified,
                lastLogin: user.lastLogin || new Date(),
                role: user.isAdmin ? 'admin' : 'user'
            };

            console.log('[TEST] ---------------------------------------------------');
            console.log('[TEST] Simulated Server Response Object:');
            console.log(safeUser);
            console.log('[TEST] JSON Stringified (what frontend receives):');
            console.log(JSON.stringify({ success: true, token: "SAMPLE_TOKEN", user: safeUser }, null, 2));
            console.log('[TEST] ---------------------------------------------------');
        }

        await mongoose.disconnect();
    } catch (err) {
        console.error('[TEST] Database check failed:', err);
    }
};

testLogin();
