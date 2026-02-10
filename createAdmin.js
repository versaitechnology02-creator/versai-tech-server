const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const dotenv = require('dotenv');

// 1. Load Environment Variables safely
// We explicitly resolve the path to ensure .env is found relative to this script
const envPath = path.resolve(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.error('Error loading .env file:', result.error);
    process.exit(1);
}

// 2. Validate Database Connection String
if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI is not defined in .env file.');
    process.exit(1);
}

// 3. Define User Schema Inline
// This avoids issues with importing TypeScript models directly in a Node.js script
// Fields are based on src/models/User.ts
const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true },

        // Admin & Verification Flags matching requirements
        isAdmin: { type: Boolean, default: false }, // Mapped from 'role: "admin"' requirement
        isVerified: { type: Boolean, default: false }, // Mapped from 'isApproved: true' requirement
        verified: { type: Boolean, default: false }, // Legacy field compatibility

        verifiedAt: { type: Date, default: null },
        status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },

        // Additional fields from schema for completeness
        company: { type: String, default: "" },
        phone: { type: String, default: "" },
        lastLogin: { type: Date, default: null }
    },
    { timestamps: true }
);

// Prevent OverwriteModelError if model is already compiled
const User = mongoose.models.User || mongoose.model('User', userSchema);

// 4. Main Admin Creation Logic
const createSuperAdmin = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB successfully.');

        const adminEmail = 'admin@versaitech.in';
        const adminPassword = 'adminpassword'; // Set default password
        const adminName = 'Super Admin';

        // Check if user already exists
        let user = await User.findOne({ email: adminEmail });

        if (user) {
            console.log(`User with email ${adminEmail} already exists.`);

            // Update existing user to be Admin if not already
            if (!user.isAdmin || !user.isVerified) {
                console.log('Updating existing user to Super Admin privileges...');
                user.isAdmin = true;
                user.isVerified = true;
                user.verified = true;
                user.verifiedAt = user.verifiedAt || new Date();
                user.password = await bcrypt.hash(adminPassword, 10); // Reset password to default
                await user.save();
                console.log('User upgraded to Super Admin and password reset.');
            } else {
                console.log('User is already a configured Super Admin.');
            }
        } else {
            // Create New Super Admin
            console.log('Creating new Super Admin user...');

            // Hash password with salt 10
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(adminPassword, salt);

            const newAdmin = new User({
                name: adminName,
                email: adminEmail,
                password: hashedPassword,
                isAdmin: true,     // Requirement: role -> isAdmin
                isVerified: true,  // Requirement: isApproved -> isVerified
                verified: true,    // Sync with legacy verified field
                verifiedAt: new Date(),
                status: 'active'
            });

            await newAdmin.save();
            console.log('Super Admin user created successfully.');
        }

        console.log('------------------------------------------------');
        console.log(`Admin Email:    ${adminEmail}`);
        console.log(`Admin Password: ${adminPassword}`);
        console.log('------------------------------------------------');

        // 5. Exit Process Safely
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
        process.exit(0);

    } catch (error) {
        console.error('Error creating admin user:', error);
        // Ensure we disconnect even on error
        try { await mongoose.disconnect(); } catch (e) { }
        process.exit(1);
    }
};

// Execute Script
createSuperAdmin();
