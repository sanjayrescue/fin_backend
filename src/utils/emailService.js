// Comprehensive Email Service for all main workflows
import { sendMail } from "./sendMail.js";

/**
 * Email templates and service functions for all main workflows
 */

// Base email template wrapper
const getEmailTemplate = (title, content, footerText = "Trustline Fintech Team") => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #12B99C 0%, #0d9488 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #12B99C; }
        .info-row { margin: 10px 0; }
        .label { font-weight: bold; color: #374151; }
        .value { color: #111827; }
        .button { display: inline-block; background: #12B99C; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
        .status-badge { display: inline-block; padding: 5px 15px; border-radius: 20px; font-weight: bold; margin: 10px 0; }
        .status-active { background: #d1fae5; color: #065f46; }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-approved { background: #d1fae5; color: #065f46; }
        .status-rejected { background: #fee2e2; color: #991b1b; }
        .status-disbursed { background: #dbeafe; color: #1e40af; }
        .alert { padding: 15px; border-radius: 6px; margin: 15px 0; }
        .alert-success { background: #d1fae5; color: #065f46; border-left: 4px solid #10b981; }
        .alert-warning { background: #fef3c7; color: #92400e; border-left: 4px solid #f59e0b; }
        .alert-error { background: #fee2e2; color: #991b1b; border-left: 4px solid #ef4444; }
        .alert-info { background: #dbeafe; color: #1e40af; border-left: 4px solid #3b82f6; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${title}</h1>
        </div>
        <div class="content">
          ${content}
          <div class="footer">
            <p>This is an automated email. Please do not reply to this message.</p>
            <p>&copy; ${new Date().getFullYear()} Trustline Fintech. All rights reserved.</p>
            <p>Regards,<br/>${footerText}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Send partner registration email
 */
export const sendPartnerRegistrationEmail = async (partner, password = null) => {
  const loginUrl = "https://trustlinefintech.com/login";
  const activationMessage = partner.status === "ACTIVE" 
    ? "Your account has been activated and is ready to use!"
    : "Your account is pending approval. You will be notified once it's activated.";
  
  const content = `
    <h2>Dear ${partner.firstName} ${partner.lastName},</h2>
    <p>Thank you for registering as a Partner with Trustline Fintech. ${activationMessage}</p>
    
    <div class="info-box">
      <h3 style="margin-top: 0; color: #12B99C;">Your Account Details</h3>
      <div class="info-row">
        <span class="label">Employee ID:</span>
        <span class="value">${partner.employeeId}</span>
      </div>
      <div class="info-row">
        <span class="label">Partner Code:</span>
        <span class="value">${partner.partnerCode}</span>
      </div>
      <div class="info-row">
        <span class="label">Email:</span>
        <span class="value">${partner.email}</span>
      </div>
      <div class="info-row">
        <span class="label">Account Status:</span>
        <span class="status-badge ${partner.status === "ACTIVE" ? "status-active" : "status-pending"}">${partner.status}</span>
      </div>
      ${password ? `
      <div class="info-row">
        <span class="label">Temporary Password:</span>
        <span class="value"><strong>${password}</strong></span>
      </div>
      <div class="alert alert-warning">
        <strong>⚠️ Important:</strong> Please change your password immediately after first login.
      </div>
      ` : ""}
    </div>
    
    <div style="text-align: center;">
      <a href="${loginUrl}" class="button">Login to Your Account</a>
    </div>
    
    <p style="margin-top: 30px;">If you have any questions or need assistance, please contact our support team.</p>
  `;

  try {
    await sendMail({
      to: partner.email,
      subject: "Welcome to Trustline Fintech - Partner Registration Successful",
      html: getEmailTemplate("Welcome to Trustline Fintech!", content),
    });
    console.log("✅ Partner registration email sent to:", partner.email);
    return true;
  } catch (error) {
    console.error("❌ Failed to send partner registration email:", error);
    return false;
  }
};

/**
 * Send loan application created email to customer
 */
export const sendLoanApplicationEmail = async (customer, application, tempPassword = null) => {
  const loginUrl = "https://trustlinefintech.com/login";
  
  const content = `
    <h2>Dear ${customer.firstName},</h2>
    <p>Your loan application has been successfully created.</p>
    
    <div class="info-box">
      <h3 style="margin-top: 0; color: #12B99C;">Application Details</h3>
      <div class="info-row">
        <span class="label">Application Number:</span>
        <span class="value">${application.appNo}</span>
      </div>
      <div class="info-row">
        <span class="label">Loan Type:</span>
        <span class="value">${application.loanType}</span>
      </div>
      <div class="info-row">
        <span class="label">Loan Amount:</span>
        <span class="value">₹${application.appliedLoanAmount || application.loanAmount || "N/A"}</span>
      </div>
      <div class="info-row">
        <span class="label">Status:</span>
        <span class="status-badge status-pending">${application.status}</span>
      </div>
    </div>
    
    ${tempPassword ? `
    <div class="info-box">
      <h3 style="margin-top: 0; color: #12B99C;">Login Credentials</h3>
      <div class="info-row">
        <span class="label">Email:</span>
        <span class="value">${customer.email}</span>
      </div>
      <div class="info-row">
        <span class="label">Password:</span>
        <span class="value"><strong>${tempPassword}</strong></span>
      </div>
      <div class="alert alert-warning">
        <strong>⚠️ Important:</strong> Please change your password after first login.
      </div>
    </div>
    ` : ""}
    
    <div style="text-align: center;">
      <a href="${loginUrl}" class="button">View Your Application</a>
    </div>
    
    <p style="margin-top: 30px;">We will keep you updated on the status of your application.</p>
  `;

  try {
    await sendMail({
      to: customer.email,
      subject: `Loan Application Created - ${application.appNo}`,
      html: getEmailTemplate("Loan Application Created", content),
    });
    console.log("✅ Loan application email sent to:", customer.email);
    return true;
  } catch (error) {
    console.error("❌ Failed to send loan application email:", error);
    return false;
  }
};

/**
 * Send application status update email
 */
export const sendApplicationStatusEmail = async (customer, application, oldStatus, newStatus) => {
  const statusMessages = {
    SUBMITTED: "Your application has been submitted and is under review.",
    DOC_INCOMPLETE: "Some documents are missing or need to be updated. Please check and upload the required documents.",
    DOC_COMPLETE: "All required documents have been received and verified.",
    UNDER_REVIEW: "Your application is currently under review by our team.",
    APPROVED: "Congratulations! Your loan application has been approved.",
    AGREEMENT: "Your loan agreement is ready. Please review and sign.",
    REJECTED: "Unfortunately, your loan application has been rejected.",
    DISBURSED: "Your loan has been disbursed successfully.",
  };

  const statusClass = {
    APPROVED: "status-approved",
    DISBURSED: "status-disbursed",
    REJECTED: "status-rejected",
  }[newStatus] || "status-pending";

  const alertClass = {
    APPROVED: "alert-success",
    DISBURSED: "alert-success",
    REJECTED: "alert-error",
  }[newStatus] || "alert-info";

  const content = `
    <h2>Dear ${customer.firstName},</h2>
    <p>Your loan application status has been updated.</p>
    
    <div class="alert ${alertClass}">
      <strong>Status Update:</strong> ${statusMessages[newStatus] || `Your application status has changed from ${oldStatus} to ${newStatus}.`}
    </div>
    
    <div class="info-box">
      <h3 style="margin-top: 0; color: #12B99C;">Application Details</h3>
      <div class="info-row">
        <span class="label">Application Number:</span>
        <span class="value">${application.appNo}</span>
      </div>
      <div class="info-row">
        <span class="label">Loan Type:</span>
        <span class="value">${application.loanType}</span>
      </div>
      <div class="info-row">
        <span class="label">Previous Status:</span>
        <span class="value">${oldStatus}</span>
      </div>
      <div class="info-row">
        <span class="label">Current Status:</span>
        <span class="status-badge ${statusClass}">${newStatus}</span>
      </div>
      ${application.approvedLoanAmount ? `
      <div class="info-row">
        <span class="label">Approved Amount:</span>
        <span class="value">₹${application.approvedLoanAmount}</span>
      </div>
      ` : ""}
    </div>
    
    <div style="text-align: center;">
      <a href="https://trustlinefintech.com/login" class="button">View Application Details</a>
    </div>
  `;

  try {
    await sendMail({
      to: customer.email,
      subject: `Loan Application Status Update - ${application.appNo}`,
      html: getEmailTemplate("Application Status Update", content),
    });
    console.log("✅ Application status email sent to:", customer.email);
    return true;
  } catch (error) {
    console.error("❌ Failed to send application status email:", error);
    return false;
  }
};

/**
 * Send document status update email
 */
export const sendDocumentStatusEmail = async (customer, application, docType, status) => {
  const statusMessages = {
    VERIFIED: "has been verified and accepted.",
    REJECTED: "has been rejected. Please upload a new document.",
    UPDATED: "needs to be updated. Please upload a new version.",
    PENDING: "is pending verification.",
  };

  const content = `
    <h2>Dear ${customer.firstName},</h2>
    <p>Your document status has been updated.</p>
    
    <div class="info-box">
      <h3 style="margin-top: 0; color: #12B99C;">Document Information</h3>
      <div class="info-row">
        <span class="label">Document Type:</span>
        <span class="value">${docType}</span>
      </div>
      <div class="info-row">
        <span class="label">Status:</span>
        <span class="status-badge ${status === "VERIFIED" ? "status-approved" : status === "REJECTED" ? "status-rejected" : "status-pending"}">${status}</span>
      </div>
      <div class="info-row">
        <span class="label">Application Number:</span>
        <span class="value">${application.appNo}</span>
      </div>
    </div>
    
    <div class="alert ${status === "VERIFIED" ? "alert-success" : status === "REJECTED" ? "alert-error" : "alert-warning"}">
      <strong>${status === "VERIFIED" ? "✓" : status === "REJECTED" ? "✗" : "!"}</strong> 
      Your ${docType} document ${statusMessages[status] || `status is now ${status}.`}
    </div>
    
    ${status === "REJECTED" || status === "UPDATED" ? `
    <div style="text-align: center;">
      <a href="https://trustlinefintech.com/login" class="button">Upload New Document</a>
    </div>
    ` : ""}
  `;

  try {
    await sendMail({
      to: customer.email,
      subject: `Document Status Update - ${docType}`,
      html: getEmailTemplate("Document Status Update", content),
    });
    console.log("✅ Document status email sent to:", customer.email);
    return true;
  } catch (error) {
    console.error("❌ Failed to send document status email:", error);
    return false;
  }
};

/**
 * Send user account creation email (for RM, ASM, etc.)
 */
export const sendUserAccountEmail = async (user, role, password, createdBy = null) => {
  const roleNames = {
    RM: "Relationship Manager",
    ASM: "Area Sales Manager",
    PARTNER: "Partner",
    ADMIN: "Administrator",
  };

  const content = `
    <h2>Dear ${user.firstName} ${user.lastName},</h2>
    <p>Your ${roleNames[role] || role} account has been successfully created${createdBy ? ` by ${createdBy.firstName} ${createdBy.lastName}` : ""}.</p>
    
    <div class="info-box">
      <h3 style="margin-top: 0; color: #12B99C;">Account Details</h3>
      <div class="info-row">
        <span class="label">Employee ID:</span>
        <span class="value">${user.employeeId || "N/A"}</span>
      </div>
      ${user.rmCode ? `
      <div class="info-row">
        <span class="label">RM Code:</span>
        <span class="value">${user.rmCode}</span>
      </div>
      ` : ""}
      ${user.asmCode ? `
      <div class="info-row">
        <span class="label">ASM Code:</span>
        <span class="value">${user.asmCode}</span>
      </div>
      ` : ""}
      ${user.partnerCode ? `
      <div class="info-row">
        <span class="label">Partner Code:</span>
        <span class="value">${user.partnerCode}</span>
      </div>
      ` : ""}
      <div class="info-row">
        <span class="label">Email:</span>
        <span class="value">${user.email}</span>
      </div>
      <div class="info-row">
        <span class="label">Role:</span>
        <span class="value">${roleNames[role] || role}</span>
      </div>
      ${password ? `
      <div class="info-row">
        <span class="label">Temporary Password:</span>
        <span class="value"><strong>${password}</strong></span>
      </div>
      <div class="alert alert-warning">
        <strong>⚠️ Important:</strong> Please log in and change your password immediately.
      </div>
      ` : ""}
    </div>
    
    <div style="text-align: center;">
      <a href="https://trustlinefintech.com/login" class="button">Login to Your Account</a>
    </div>
  `;

  try {
    await sendMail({
      to: user.email,
      subject: `Your ${roleNames[role] || role} Account Has Been Created`,
      html: getEmailTemplate("Account Created", content),
    });
    console.log(`✅ ${role} account email sent to:`, user.email);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send ${role} account email:`, error);
    return false;
  }
};

/**
 * Send payout notification email
 */
export const sendPayoutEmail = async (partner, payout) => {
  const content = `
    <h2>Dear ${partner.firstName} ${partner.lastName},</h2>
    <p>Your payout status has been updated.</p>
    
    <div class="info-box">
      <h3 style="margin-top: 0; color: #12B99C;">Payout Details</h3>
      <div class="info-row">
        <span class="label">Payout ID:</span>
        <span class="value">${payout.payoutId || payout._id}</span>
      </div>
      <div class="info-row">
        <span class="label">Amount:</span>
        <span class="value">₹${payout.amount}</span>
      </div>
      <div class="info-row">
        <span class="label">Status:</span>
        <span class="status-badge ${payout.status === "PAID" ? "status-approved" : payout.status === "REJECTED" ? "status-rejected" : "status-pending"}">${payout.status}</span>
      </div>
      ${payout.paymentDate ? `
      <div class="info-row">
        <span class="label">Payment Date:</span>
        <span class="value">${new Date(payout.paymentDate).toLocaleDateString()}</span>
      </div>
      ` : ""}
    </div>
    
    <div style="text-align: center;">
      <a href="https://trustlinefintech.com/login" class="button">View Payout Details</a>
    </div>
  `;

  try {
    await sendMail({
      to: partner.email,
      subject: `Payout Status Update - ₹${payout.amount}`,
      html: getEmailTemplate("Payout Status Update", content),
    });
    console.log("✅ Payout email sent to:", partner.email);
    return true;
  } catch (error) {
    console.error("❌ Failed to send payout email:", error);
    return false;
  }
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (user, resetToken, resetUrl) => {
  const content = `
    <h2>Dear ${user.firstName} ${user.lastName},</h2>
    <p>You have requested to reset your password.</p>
    
    <div class="alert alert-info">
      <strong>Reset Link:</strong> Click the button below to reset your password. This link will expire in 1 hour.
    </div>
    
    <div style="text-align: center;">
      <a href="${resetUrl}" class="button">Reset Password</a>
    </div>
    
    <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">
      If you did not request this password reset, please ignore this email or contact support.
    </p>
  `;

  try {
    await sendMail({
      to: user.email,
      subject: "Password Reset Request - Trustline Fintech",
      html: getEmailTemplate("Password Reset", content),
    });
    console.log("✅ Password reset email sent to:", user.email);
    return true;
  } catch (error) {
    console.error("❌ Failed to send password reset email:", error);
    return false;
  }
};
