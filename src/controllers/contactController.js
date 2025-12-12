import nodemailer from "nodemailer";

export const contactFunction = async (req, res) => {
  const { name, email, phone, message } = req.body;
  
  // Validate input
  if (!name || !email || !phone || !message) {
    return res.status(400).json({ 
      success: false, 
      message: "All fields (name, email, phone, message) are required." 
    });
  }

  // Check email credentials before attempting to send
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("Contact form: Email credentials are missing. Skipping email send.");
    return res.status(500).json({
      success: false,
      message: "Email service is not configured. Please contact support directly.",
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"${name}" <${process.env.EMAIL_USER}>`, // ✅ your domain email
      replyTo: email, // ✅ customer's real email
      to: process.env.EMAIL_USER, // ✅ your inbox
      subject: `[TrustlineFin] New Inquiry - ${name}`,
      html: `
        <h2>📩 New Inquiry Received</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Message:</strong> ${message}</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ success: true, message: "Email sent successfully." });
  } catch (error) {
    console.error("Email error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send email. Please try again later or contact support directly." 
    });
  }
};
