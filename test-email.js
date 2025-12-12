/**
 * Email Configuration Test Script
 * 
 * Run this script to test your SMTP configuration:
 * node test-email.js
 * 
 * Make sure your .env file has EMAIL_USER and EMAIL_PASS set
 */

import "dotenv/config.js";
import nodemailer from "nodemailer";

const testEmail = async () => {
  console.log("🧪 Testing Email Configuration...\n");

  // Check credentials
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ ERROR: EMAIL_USER and EMAIL_PASS must be set in .env file");
    process.exit(1);
  }

  console.log(`📧 Email User: ${process.env.EMAIL_USER}`);
  console.log(`🔑 Password: ${process.env.EMAIL_PASS ? "***" + process.env.EMAIL_PASS.slice(-4) : "NOT SET"}\n`);

  // Test configurations
  const configs = [
    {
      name: "Port 587 (TLS)",
      config: {
        host: "smtp.hostinger.com",
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
        requireTLS: true,
      },
    },
    {
      name: "Port 465 (SSL)",
      config: {
        host: "smtp.hostinger.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      },
    },
  ];

  for (const { name, config } of configs) {
    console.log(`\n🔍 Testing: ${name}...`);
    
    try {
      const transporter = nodemailer.createTransport(config);
      
      // Test connection
      console.log("   → Verifying connection...");
      await transporter.verify();
      console.log(`   ✅ Connection successful!`);
      
      // Test sending
      console.log("   → Sending test email...");
      const info = await transporter.sendMail({
        from: `"Trustline Fintech Test" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER, // Send to yourself for testing
        subject: "Test Email from Trustline Backend",
        html: `
          <h2>✅ Email Test Successful!</h2>
          <p>This is a test email from your Trustline backend.</p>
          <p><strong>Configuration:</strong> ${name}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        `,
      });
      
      console.log(`   ✅ Email sent successfully!`);
      console.log(`   📬 Message ID: ${info.messageId}`);
      console.log(`\n✅ SUCCESS: ${name} is working correctly!\n`);
      
      // Exit on first success
      process.exit(0);
      
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      
      if (error.message.includes("535") || error.message.includes("authentication")) {
        console.error(`\n   🔴 Authentication Error Detected!`);
        console.error(`   Please check:`);
        console.error(`   1. EMAIL_USER should be full email: ${process.env.EMAIL_USER}`);
        console.error(`   2. EMAIL_PASS is correct`);
        console.error(`   3. If 2FA is enabled, use App Password instead of regular password`);
        console.error(`   4. SMTP access is enabled in Hostinger control panel\n`);
      }
    }
  }

  console.error("\n❌ All email configurations failed. Please check your credentials and SMTP settings.");
  process.exit(1);
};

testEmail().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});

