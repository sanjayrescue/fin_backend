/**
 * Test the actual sendMail function
 * Run: node test-sendmail.js
 */

import "dotenv/config.js";
import { sendMail } from "./src/utils/sendMail.js";

const testEmail = async () => {
  console.log("🧪 Testing sendMail function...\n");

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ ERROR: EMAIL_USER and EMAIL_PASS must be set in .env file");
    process.exit(1);
  }

  try {
    console.log(`📧 Sending test email to: ${process.env.EMAIL_USER}`);
    
    const result = await sendMail({
      to: process.env.EMAIL_USER,
      subject: "Test from sendMail Function",
      html: `
        <h2>✅ sendMail Function Test</h2>
        <p>If you receive this email, the sendMail function is working correctly!</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      `,
    });

    console.log("\n✅ SUCCESS! Email sent using sendMail function!");
    console.log(`📬 Message ID: ${result.messageId}`);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ FAILED to send email:");
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }
};

testEmail();

