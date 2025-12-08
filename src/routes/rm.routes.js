import { Router } from "express";
import argon2 from "argon2";
import { auth } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../config/roles.js";
import { User } from "../models/User.js";
import { makePartnerCode } from "../utils/codes.js";
import { Application, APP_STATUSES } from "../models/Application.js";
import { Payout } from "../models/Payout.js";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { generateEmployeeId } from "../utils/generateEmployeeId.js";
import { Target } from "../models/Target.js";
import mongoose from "mongoose";
import mime from "mime-types";
import { partnerUpload } from "../middleware/profileUpload.js";
import { upload } from "../middleware/upload.js";
import { FollowUp } from "../models/followUp.js";
import dayjs from "dayjs";
import { sendMail } from "../utils/sendMail.js";

const router = Router();

router.post(
  "/create-partners",
  auth,
  requireRole(ROLES.RM),
  upload.any(), // Accept any file field name
  async (req, res) => {
    try {
      // Parse partner details from JSON
      const partnerData = JSON.parse(req.body.newFormData || "{}");

      const {
        firstName,
        middleName,
        lastName,
        phone,
        dob,
        email,
        region,
        aadharNumber,
        panNumber,
        pincode,
        employmentType,
        address,
        homeType,
        addressStability,
        landmark,
        bankName,
        accountNumber,
        ifscCode,
        password,
      } = partnerData;

      // Required fields validation
      if (!firstName || !lastName || !phone || !email) {
        return res.status(400).json({
          message: "firstName, lastName, phone, and email are required",
        });
      }

      // Check if email or phone already exists
      const exists = await User.findOne({
        $or: [{ email: email.toLowerCase() }, { phone }],
      });

      if (exists) {
        return res
          .status(409)
          .json({ message: "Email or phone already in use" });
      }

      const rawPassword =
        password || `Pt@${Math.random().toString(36).slice(2, 10)}`;

      // Map uploaded files into docs array dynamically
      let docs = [];
      if (req.files) {
        req.files.forEach((file) => {
          docs.push({
            docType: file.fieldname.toUpperCase(),
            url: file.path,
            uploadedBy: req.user.sub,
            status: "PENDING",
          });
        });
      }

      // Create partner
      const partner = await User.create({
        _id: new mongoose.Types.ObjectId(),
        employeeId: await generateEmployeeId("PARTNER"),
        firstName,
        middleName,
        lastName,
        phone,
        dob,
        email: email.toLowerCase(),
        aadharNumber,
        panNumber,
        region,
        pincode,
        employmentType,
        address,
        homeType,
        addressStability,
        landmark,
        bankName,
        accountNumber,
        ifscCode,
        passwordHash: await argon2.hash(rawPassword),
        role: ROLES.PARTNER,
        partnerCode: makePartnerCode(),
        rmId: req.user.sub,
        status: "ACTIVE",
        docs,
      });

      // 📧 Send mail to partner after creation
      try {
        await sendMail({
          to: partner.email,
          subject: "Your Partner Account Has Been Created",
          html: `
            <p>Dear ${partner.firstName} ${partner.lastName},</p>
            <p>Your Partner account has been successfully created by your RM.</p>
            <p><b>Employee ID:</b> ${partner.employeeId}<br/>
               <b>Partner Code:</b> ${partner.partnerCode}<br/>
               <b>Email:</b> ${partner.email}<br/>
               <b>Temporary Password:</b> ${
                 password ? "Set by you" : rawPassword
               }</p>
            <p>Please log in and change your password immediately.</p>
            <br/>
            <p>Regards,<br/>Trustline Fintech</p>
          `,
        });
        console.log("📧 Partner creation mail sent to:", partner.email);
      } catch (mailErr) {
        console.error(
          "❌ Failed to send partner creation email:",
          mailErr.message
        );
      }

      // 🔹 STEP 2: Redistribute RM target among all Partners
      const now = new Date();
      const month = now.getMonth() + 1; // current month
      const year = now.getFullYear();

      const rmTargetDoc = await Target.findOne({
        assignedTo: req.user.sub,
        role: ROLES.RM,
        month,
        year,
      });

      if (rmTargetDoc) {
        // Get all Partners under this RM
        const partners = await User.find({
          role: ROLES.PARTNER,
          rmId: req.user.sub,
        }).lean();
        const perPartnerTarget = rmTargetDoc.targetValue / partners.length;

        for (let p of partners) {
          let pT = await Target.findOne({
            assignedTo: p._id,
            role: ROLES.PARTNER,
            month,
            year,
          });

          if (pT) {
            pT.targetValue = perPartnerTarget; // redistribute equally
            await pT.save();
          } else {
            pT = await Target.create({
              assignedBy: rmTargetDoc.assignedBy,
              assignedTo: p._id,
              role: ROLES.PARTNER,
              month,
              year,
              targetValue: perPartnerTarget,
            });
          }
        }
      }

      res.status(201).json({
        message: "Partner created successfully and targets redistributed",
        id: partner._id,
        partnerCode: partner.partnerCode,
        rmId: partner.rmId,
        tempPassword: password ? undefined : rawPassword,
        docs,
      });
    } catch (err) {
      console.error("Error creating partner:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  }
);

router.get("/get-partners", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const rmId = req.user.sub;

    // Fetch all partners under this RM
    const partners = await User.find({ role: ROLES.PARTNER, rmId })
      .select("-passwordHash")
      .lean();

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const BASE_URL = process.env.BACKEND_URL || "http://localhost:5000";

    const partnerData = await Promise.all(
      partners.map(async (partner) => {
        // Get RM info to fetch ASM
        const rm = await User.findById(partner.rmId)
          .select("firstName lastName asmId")
          .lean();

        // Get ASM info from RM
        const asm = rm?.asmId
          ? await User.findById(rm.asmId).select("firstName lastName").lean()
          : null;

        // ===== Revenue (from Payouts) =====
        const revenueAgg = await Payout.aggregate([
          { $match: { partnerId: partner._id } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const revenueGenerated = revenueAgg[0]?.total || 0;

        // ===== Disbursed Loans =====
        const disbursedAgg = await Application.aggregate([
          { $match: { partnerId: partner._id, status: "DISBURSED" } },
          {
            $group: {
              _id: null,
              total: { $sum: { $toDouble: "$approvedLoanAmount" } },
            },
          },
        ]);
        const totalDisbursed = disbursedAgg[0]?.total || 0;

        // ===== Assigned Target =====
        const targetDoc = await Target.findOne({
          assignedTo: partner._id,
          role: ROLES.PARTNER,
          month: currentMonth,
          year: currentYear,
        });
        const assignedTarget = targetDoc ? Number(targetDoc.targetValue) : 0;

        // ===== Performance % =====
        const performance =
          assignedTarget > 0
            ? ((totalDisbursed / assignedTarget) * 100).toFixed(2)
            : "0.00";

        // ===== Deals & Success =====
        const dealsCount = await Application.countDocuments({
          partnerId: partner._id,
        });
        const successCount = await Application.countDocuments({
          partnerId: partner._id,
          status: "APPROVED",
        });
        const successRate =
          dealsCount > 0 ? Math.round((successCount / dealsCount) * 100) : 0;

        // ===== Profile Pic =====
        const profilePic =
          (partner.docs || [])
            .find((doc) => doc.docType === "SELFIE")
            ?.url.replace(/\\/g, "/")
            .replace(/^\/+/, "") || null;

        const profilePicUrl = profilePic
          ? `${BASE_URL.replace(/\/$/, "")}/${profilePic}`
          : null;

        return {
          id: partner._id,
          rmId: partner.rmId,
          rmName: rm ? `${rm.firstName} ${rm.lastName}` : null,
          asmId: asm?._id || null,
          asmName: asm ? `${asm.firstName} ${asm.lastName}` : null,
          name: `${partner.firstName} ${partner.lastName}`,
          email: partner.email,
          phone: partner.phone,
          status: partner.status,
          rating: partner.rating || 0,

          // Existing
          dealsThisMonth: dealsCount,
          revenueGenerated,
          successRate,

          // Added analytics
          totalDisbursed,
          assignedTarget,
          performance: `${performance}%`,

          lastActive: partner.lastLoginAt,
          profilePic: profilePicUrl,
        };
      })
    );

    res.json(partnerData);
  } catch (err) {
    console.error("Error fetching partners list:", err);
    res.status(500).json({ message: "Error fetching partners list" });
  }
});

router.get(
  "/partner/:partnerId/customers",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const rmId = req.user.sub; // RM from token
      const { partnerId } = req.params;

      // 1. Verify that this Partner belongs to this RM
      const partner = await User.findOne({
        _id: partnerId,
        role: ROLES.PARTNER,
        rmId,
      })
        .select("firstName lastName email phone employeeId")
        .lean();

      if (!partner) {
        return res
          .status(404)
          .json({ message: "Partner not found under this RM" });
      }

      // 2. Fetch Customers under this Partner
      const customers = await User.find({ role: ROLES.CUSTOMER, partnerId })
        .select("-passwordHash -__v")
        .lean();

      // 3. Prepare single object response
      const response = {
        partnerId: partner._id,
        partnerName: `${partner.firstName} ${partner.lastName}`,
        partnerEmployeeId: partner.employeeId,
        partnerEmail: partner.email,
        partnerPhone: partner.phone,
        totalCustomers: customers.length,
        customers: customers.map((cust) => ({
          id: cust._id,
          name: `${cust.firstName} ${cust.lastName}`,
          email: cust.email,
          phone: cust.phone,
          status: cust.status,
          createdAt: cust.createdAt,
          updatedAt: cust.updatedAt,
        })),
      };

      res.json(response);
    } catch (err) {
      console.error("Error fetching customers under Partner:", err);
      res.status(500).json({ message: "Error fetching Partner's customers" });
    }
  }
);

router.get(
  "/partners-with-followup",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const rmId = req.user.sub;

      // Fetch partners assigned to this RM
      const partners = await User.find({ role: ROLES.PARTNER, rmId })
        .select("employeeId firstName lastName phone email status")
        .lean();

      const partnerData = await Promise.all(
        partners.map(async (partner) => {
          // Get last follow-up (latest one)
          const lastFollowUp = await FollowUp.findOne({
            partnerId: partner._id,
          })
            .sort({ updatedAt: -1 })
            .lean();

          return {
            employeeId: partner?.employeeId,
            partnerId: partner._id,
            name: `${partner.firstName} ${partner.lastName}`,
            phone: partner.phone,
            status: lastFollowUp?.status || "N/A",
            remarks: lastFollowUp?.remarks || "",
            lastCall: lastFollowUp?.lastCall
              ? dayjs(lastFollowUp.lastCall).format("DD MMM YYYY, hh:mm a")
              : null,
          };
        })
      );

      res.json(partnerData);
    } catch (err) {
      console.error("Error fetching partner follow-ups:", err);
      res.status(500).json({ message: "Error fetching partner follow-ups" });
    }
  }
);

router.post(
  "/update-followup/:partnerId",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const { partnerId } = req.params;
      const { status, remarks, lastCall } = req.body;

      let parsedDate = new Date(); // default current date
      if (lastCall) {
        parsedDate = dayjs(lastCall, "DD MMM YYYY, hh:mm a").toDate();
      }

      const followUp = new FollowUp({
        partnerId,
        status,
        remarks,
        lastCall: parsedDate,
        updatedBy: req.user.sub,
      });

      await followUp.save();

      res.json({
        message: "Follow-up updated successfully",
        followUp: {
          ...followUp.toObject(),
          lastCall: dayjs(followUp.lastCall).format("DD MMM YYYY, hh:mm a"),
        },
      });
    } catch (err) {
      console.error("Error updating follow-up:", err);
      res.status(500).json({ message: "Error updating follow-up" });
    }
  }
);

// GET /rm/top-performer  get top performer
router.get("/top-performer", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const rmId = req.user.sub;

    const topPartner = await Payout.aggregate([
      { $match: { rmId } },
      { $group: { _id: "$partnerId", totalRevenue: { $sum: "$amount" } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
    ]);

    if (!topPartner.length) {
      return res.json({ message: "No top performer yet" });
    }

    const partner = await User.findById(topPartner[0]._id).select(
      "firstName lastName email rating"
    );
    res.json({
      id: partner._id,
      name: `${partner.firstName} ${partner.lastName}`,
      rating: partner.rating,
      revenue: topPartner[0].totalRevenue,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching top performer" });
  }
});

router.post(
  "/applications/:id/transition",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const { to, note, approvedLoanAmount } = req.body;

      if (!to)
        return res.status(400).json({ message: "Target status 'to' required" });

      if (!APP_STATUSES.includes(to))
        return res.status(400).json({ message: "Invalid status" });

      const app = await Application.findOne({
        _id: req.params.id,
        rmId: req.user.sub,
      }).populate("customerId");

      if (!app)
        return res
          .status(404)
          .json({ message: "Application not found under this RM" });

      // ✅ Only set approvedLoanAmount for DISBURSED
      if (to === "DISBURSED") {
        if (approvedLoanAmount == null || isNaN(Number(approvedLoanAmount))) {
          return res.status(400).json({
            message: "approvedLoanAmount is required and must be a number",
          });
        }
        app.approvedLoanAmount = Number(approvedLoanAmount);
      }

      // Transition
      app.transition(to, req.user.sub, note);

      // ✅ If status = REJECTED → mark for auto-delete after 3 months
      if (to === "REJECTED") {
        const threeMonthsLater = new Date(
          Date.now() + 90 * 24 * 60 * 60 * 1000
        );

        app.deletedAt = threeMonthsLater; // Application TTL
        await User.findByIdAndUpdate(app.customerId._id, {
          deletedAt: threeMonthsLater, // Customer TTL
        });
      }

      await app.save();

      // 📧 Always send mail (for ALL statuses)
      try {
        let extraInfo = "";

        switch (to) {
          case "DISBURSED":
            extraInfo = `<p><b>Approved Loan Amount:</b> ₹${app.approvedLoanAmount}</p>`;
            break;
          case "AGREEMENT":
            extraInfo = `<p><b>Next Step:</b> Please review and sign your loan agreement.</p>`;
            break;
          case "APPROVED":
            extraInfo = `<p>Your loan application has been approved. 🎉</p>`;
            break;
          case "REJECTED":
            extraInfo = `<p>Unfortunately, your loan application has been rejected. You may reapply after 3 months.</p>`;
            break;
          default:
            extraInfo = `<p>Status updated successfully.</p>`;
        }

        await sendMail({
          to: app.customerId.email,
          subject: `Loan Application Status: ${to}`,
          html: `
            <p>Dear ${app.customerId.firstName || "Customer"},</p>
            <p>Your loan application status has been updated.</p>
            <p><b>New Status:</b> ${to}</p>
            ${note ? `<p><b>Remarks:</b> ${note}</p>` : ""}
            ${extraInfo}
            <br/>
            <p>Thank you,<br/>Trustline Fintech</p>
          `,
        });
      } catch (mailErr) {
        console.error("Failed to send status email:", mailErr.message);
      }

      res.json({
        message: "Status updated",
        status: app.status,
        approvedLoanAmount: app.approvedLoanAmount,
        stageHistory: app.stageHistory,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: e.message });
    }
  }
);

router.post(
  "/deactivate-partner",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const { oldPartnerId } = req.body;

      if (!oldPartnerId) {
        return res.status(400).json({ message: "oldPartnerId is required" });
      }

      const oldId = new mongoose.Types.ObjectId(oldPartnerId);

      // 1️⃣ Validate old partner
      const oldPartner = await User.findById(oldId);
      if (!oldPartner || oldPartner.role !== ROLES.PARTNER) {
        return res
          .status(404)
          .json({ message: "Old partner not found or not a partner" });
      }

      // 2️⃣ Deactivate old partner
      const deactivatedPartner = await User.findByIdAndUpdate(
        oldId,
        { $set: { status: "SUSPENDED", updatedAt: new Date() } },
        { new: true }
      );
      console.log(`Partner ${oldId} deactivated`);

      // 3️⃣ Send email
      try {
        await sendMail({
          to: deactivatedPartner.email,
          subject: "Your Partner Account Has Been Deactivated",
          html: `
          <p>Dear ${deactivatedPartner.firstName} ${deactivatedPartner.lastName},</p>
          <p>Your Partner account has been <b>deactivated</b>.</p>
          <p>If you believe this is an error, contact support immediately.</p>
        `,
        });
        console.log("Deactivation email sent");
      } catch (err) {
        console.error("Failed to send email:", err.message);
      }

      return res.json({
        message: `Partner ${deactivatedPartner.firstName} ${deactivatedPartner.lastName} has been deactivated.`,
        deactivatedPartner: {
          id: deactivatedPartner._id,
          name: `${deactivatedPartner.firstName} ${deactivatedPartner.lastName}`,
          email: deactivatedPartner.email,
        },
      });
    } catch (error) {
      console.error("Error in /deactivate-partner:", error);
      res
        .status(500)
        .json({ message: "Internal server error", error: error.message });
    }
  }
);

router.post("/partner/activate", async (req, res) => {
  try {
    const { partnerId } = req.body;

    if (!partnerId) {
      return res.status(400).json({ message: "partnerId is required" });
    }

    // Activate partner and get updated document
    const partner = await User.findByIdAndUpdate(
      partnerId,
      { status: "ACTIVE" },
      { new: true }
    );

    if (!partner) {
      return res.status(404).json({ message: "Partner not found" });
    }

    // 📧 Send activation email
    try {
      await sendMail({
        to: partner.email,
        subject: "Your Partner Account Has Been Activated",
        html: `
          <p>Dear ${partner.firstName} ${partner.lastName},</p>
          <p>We are pleased to inform you that your Partner account has been <b>activated</b> successfully.</p>
          <p><b>Partner ID:</b> ${partner.partnerCode || "-"}</p>
          <p>You can now log in and continue managing your Customers as usual.</p>
          <br/>
          <p>Regards,<br/>Trustline Fintech</p>
        `,
      });
      console.log("📧 Activation mail sent to:", partner.email);
    } catch (mailErr) {
      console.error("❌ Failed to send activation email:", mailErr.message);
    }

    res.json({
      message: "Partner activated successfully and notified via email",
      partner,
    });
  } catch (error) {
    console.error("Error in /partner/activate:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /partner/active list
router.get("/active/partner", async (req, res) => {
  try {
    const activePartners = await User.find({
      role: ROLES.PARTNER,
      status: "ACTIVE",
    });

    res.json({
      message: "Active PARTNER list fetched successfully",
      activePartners,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// router.get("/dashboard", auth, requireRole(ROLES.RM), async (req, res) => {
//   try {
//     const rmId = req.user.sub; // RM ID from token

//     // RM Details
//     const rm = await User.findOne({ _id: rmId, role: ROLES.RM }).lean();
//     if (!rm) return res.status(404).json({ message: "RM not found" });

//     // Partners under RM
//     const partners = await User.find({ rmId, role: ROLES.PARTNER }).lean();
//     const partnerIds = partners.map((p) => p._id);

//     const totalPartners = partners.length;
//     const activePartners = await User.countDocuments({
//       rmId,
//       role: ROLES.PARTNER,
//       status: "ACTIVE",
//     });

//     // Customers under RM
//     const customers = await Application.distinct("customerId", { rmId });
//     const totalCustomers = customers.length;

//     // In-process applications
//     const inProcessApplications = await Application.countDocuments({
//       rmId,
//       status: "UNDER_REVIEW",
//     });

//     // Revenue
//     const revenueAgg = await Application.aggregate([
//       {
//         $match: {
//           rmId: new mongoose.Types.ObjectId(rmId),
//           status: "DISBURSED",
//         },
//       },
//       {
//         $group: {
//           _id: null,
//           total: { $sum: { $ifNull: ["$approvedLoanAmount", 0] } },
//         },
//       },
//     ]);
//     const totalRevenue = revenueAgg[0]?.total || 0;

//     // Avg partner rating
//     const ratings = partners.map((p) => p.rating || 0);
//     const avgRating = ratings.length
//       ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
//       : 0;

//     // 12-month targets and achieved
//     const now = new Date();
//     const startOfYear = new Date(now.getFullYear(), 0, 1);

//     // Monthly Target from Target collection
//     // const monthlyTarget = await Target.aggregate([
//     //   {
//     //     $match: {
//     //       assignedTo: { $in: partnerIds }, // Correct field
//     //       createdAt: { $gte: startOfYear },
//     //     },
//     //   },
//     //   {
//     //     $group: {
//     //       _id: { month: { $month: "$createdAt" } },
//     //       totalTarget: { $sum: "$targetValue" }, // Correct field
//     //     },
//     //   },
//     //   { $sort: { "_id.month": 1 } },
//     // ]);

//     const monthlyTarget = await Target.aggregate([
//       {
//         $match: {
//           $or: [
//             { assignedTo: rm._id }, // RM's own target
//             { assignedTo: { $in: partnerIds } }, // Partners' targets
//           ],
//           createdAt: { $gte: startOfYear },
//         },
//       },
//       {
//         $group: {
//           _id: { month: { $month: "$createdAt" } },
//           totalTarget: { $sum: "$targetValue" },
//         },
//       },
//       { $sort: { "_id.month": 1 } },
//     ]);

//     // Monthly Achieved from Application
//     const monthlyAchieved = await Application.aggregate([
//       {
//         $match: {
//           rmId: new mongoose.Types.ObjectId(rmId),
//           status: "DISBURSED",
//           createdAt: { $gte: startOfYear },
//         },
//       },
//       {
//         $group: {
//           _id: { month: { $month: "$createdAt" } },
//           totalAchieved: { $sum: { $toDouble: "$approvedLoanAmount" } },
//         },
//       },
//       { $sort: { "_id.month": 1 } },
//     ]);

//     const monthNames = [
//       "January",
//       "February",
//       "March",
//       "April",
//       "May",
//       "June",
//       "July",
//       "August",
//       "September",
//       "October",
//       "November",
//       "December",
//     ];

//     const targets = Array.from({ length: 12 }, (_, i) => {
//       const month = i + 1;
//       const t =
//         monthlyTarget.find((m) => m._id.month === month)?.totalTarget || 0;
//       const a =
//         monthlyAchieved.find((m) => m._id.month === month)?.totalAchieved || 0;
//       return { month: monthNames[i], target: t, achieved: a };
//     });

//     // High-value customers
//     const highValueCustomers = await Application.aggregate([
//       {
//         $match: {
//           rmId: new mongoose.Types.ObjectId(rmId),
//           status: "DISBURSED",
//         },
//       },
//       {
//         $group: {
//           _id: "$customerId",
//           maxLoan: { $max: { $toDouble: "$approvedLoanAmount" } },
//           latestApp: { $first: "$$ROOT" },
//         },
//       },
//       { $sort: { maxLoan: -1 } },
//       { $limit: 10 },
//       {
//         $lookup: {
//           from: "users",
//           localField: "_id",
//           foreignField: "_id",
//           as: "customer",
//         },
//       },
//       { $unwind: "$customer" },
//       {
//         $project: {
//           customerId: "$customer._id",
//           name: { $concat: ["$customer.firstName", " ", "$customer.lastName"] },
//           email: "$customer.email",
//           phone: "$customer.phone",
//           maxLoan: 1,
//           status: "$latestApp.status",
//         },
//       },
//     ]);

//     // Sales pipeline (UNDER_REVIEW)
//     const salesPipeline = await Application.aggregate([
//       {
//         $match: {
//           rmId: new mongoose.Types.ObjectId(rmId),
//           status: "UNDER_REVIEW",
//         },
//       },
//       {
//         $addFields: {
//           requestedAmountNum: { $ifNull: ["$customer.loanAmount", 0] },
//         },
//       },
//       { $sort: { requestedAmountNum: -1, createdAt: -1 } },
//       {
//         $group: {
//           _id: "$customerId",
//           maxLoan: { $first: "$requestedAmountNum" },
//           latestApp: { $first: "$$ROOT" },
//         },
//       },
//       { $limit: 10 },
//       {
//         $lookup: {
//           from: "users",
//           localField: "_id",
//           foreignField: "_id",
//           as: "customer",
//         },
//       },
//       { $unwind: "$customer" },
//       {
//         $project: {
//           customerId: "$customer._id",
//           name: { $concat: ["$customer.firstName", " ", "$customer.lastName"] },
//           email: "$customer.email",
//           phone: "$customer.phone",
//           maxLoan: 1,
//           status: "$latestApp.status",
//         },
//       },
//     ]);

//     res.json({
//       totals: {
//         totalPartners,
//         activePartners,
//         totalCustomers,
//         totalRevenue,
//         avgRating,
//         inProcessApplications,
//       },
//       targets,
//       highValueCustomers,
//       salesPipeline,
//     });
//   } catch (error) {
//     console.error("Error in RM dashboard:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// });

//// GET /rm/customers


router.get("/dashboard", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const rmId = req.user.sub; // RM ID from token

    // RM Details
    const rm = await User.findOne({ _id: rmId, role: ROLES.RM }).lean();
    if (!rm) return res.status(404).json({ message: "RM not found" });

    // Partners under RM
    const partners = await User.find({ rmId, role: ROLES.PARTNER }).lean();
    const partnerIds = partners.map((p) => p._id);

    const totalPartners = partners.length;
    const activePartners = await User.countDocuments({
      rmId,
      role: ROLES.PARTNER,
      status: "ACTIVE",
    });

    // Customers under RM
    const customers = await Application.distinct("customerId", { rmId });
    const totalCustomers = customers.length;

    // In-process applications
    const inProcessApplications = await Application.countDocuments({
      rmId,
      status: "UNDER_REVIEW",
    });

    // Revenue
    const revenueAgg = await Application.aggregate([
      {
        $match: {
          rmId: new mongoose.Types.ObjectId(rmId),
          status: "DISBURSED",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$approvedLoanAmount", 0] } },
        },
      },
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    // Avg partner rating
    const ratings = partners.map((p) => p.rating || 0);
    const avgRating = ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : 0;

    // 12-month RM targets and achieved
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // RM's own monthly targets
    const monthlyTarget = await Target.aggregate([
      {
        $match: {
          assignedTo: rm._id,
          role: ROLES.RM,
          createdAt: { $gte: startOfYear },
        },
      },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          totalTarget: { $sum: "$targetValue" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

    // Monthly Achieved from Applications under RM
    const monthlyAchieved = await Application.aggregate([
      {
        $match: {
          rmId: new mongoose.Types.ObjectId(rmId),
          status: "DISBURSED",
          createdAt: { $gte: startOfYear },
        },
      },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          totalAchieved: { $sum: { $toDouble: "$approvedLoanAmount" } },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];

    const targets = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const t =
        monthlyTarget.find((m) => m._id.month === month)?.totalTarget || 0;
      const a =
        monthlyAchieved.find((m) => m._id.month === month)?.totalAchieved || 0;
      return { month: monthNames[i], target: t, achieved: a };
    });

    // High-value customers (top 10 disbursed loans)
    const highValueCustomers = await Application.aggregate([
      { $match: { rmId: new mongoose.Types.ObjectId(rmId), status: "DISBURSED" } },
      { $group: { _id: "$customerId", maxLoan: { $max: { $toDouble: "$approvedLoanAmount" } }, latestApp: { $first: "$$ROOT" } } },
      { $sort: { maxLoan: -1 } },
      { $limit: 10 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "customer" } },
      { $unwind: "$customer" },
      { $project: {
          customerId: "$customer._id",
          name: { $concat: ["$customer.firstName", " ", "$customer.lastName"] },
          email: "$customer.email",
          phone: "$customer.phone",
          maxLoan: 1,
          status: "$latestApp.status"
        }
      }
    ]);

    // Sales pipeline (UNDER_REVIEW applications)
    const salesPipeline = await Application.aggregate([
      { $match: { rmId: new mongoose.Types.ObjectId(rmId), status: "UNDER_REVIEW" } },
      { $addFields: { requestedAmountNum: { $ifNull: ["$customer.loanAmount", 0] } } },
      { $sort: { requestedAmountNum: -1, createdAt: -1 } },
      { $group: { _id: "$customerId", maxLoan: { $first: "$requestedAmountNum" }, latestApp: { $first: "$$ROOT" } } },
      { $limit: 10 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "customer" } },
      { $unwind: "$customer" },
      { $project: {
          customerId: "$customer._id",
          name: { $concat: ["$customer.firstName", " ", "$customer.lastName"] },
          email: "$customer.email",
          phone: "$customer.phone",
          maxLoan: 1,
          status: "$latestApp.status"
        }
      }
    ]);

    // Response
    res.json({
      totals: {
        totalPartners,
        activePartners,
        totalCustomers,
        totalRevenue,
        avgRating,
        inProcessApplications,
      },
      targets, // RM monthly targets & achieved
      highValueCustomers,
      salesPipeline,
    });

  } catch (error) {
    console.error("Error in RM dashboard:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/customers", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const rmId = req.user.sub; // RM logged in

    // Find all applications under this RM
    const applications = await Application.find({ rmId })
      .populate("customerId", "employeeId firstName lastName email phone") // ✅ get employeeId from User
      .populate("partnerId", "firstName lastName email phone")
      .lean();

    // Get all payouts for these applications
    const appIds = applications.map((app) => app._id);
    const payouts = await Payout.find({ application: { $in: appIds } })
      .select("application payOutStatus")
      .lean();

    const payoutMap = {};
    payouts.forEach((p) => {
      payoutMap[p.application.toString()] = p.payOutStatus;
    });

    // Map customers list with application summary
    const customers = applications.map((app) => ({
      customerId: app.customerId?._id,
      customerEmployeeId: app.customerId?.employeeId || null, // employeeId from User
      customerName: `${app.customerId?.firstName ?? ""} ${
        app.customerId?.lastName ?? ""
      }`.trim(),
      contact: app.customerId?.phone || null,
      email: app.customerId?.email || null,
      loanType: app.loanType,
      requestedAmount: app.customer?.loanAmount || null,
      approvedAmount: app.approvedLoanAmount || null,
      status: app.status,
      payOutStatus: payoutMap[app._id.toString()] || "PENDING",
      partner: {
        partnerId: app.partnerId?._id,
        name: `${app.partnerId?.firstName ?? ""} ${
          app.partnerId?.lastName ?? ""
        }`.trim(),
        email: app.partnerId?.email,
        phone: app.partnerId?.phone,
      },
      applicationId: app._id,
      createdAt: app.createdAt,
    }));

    return res.json(customers);
  } catch (err) {
    console.error("Error fetching RM customers:", err);
    return res.status(500).json({ message: "Error fetching RM customers" });
  }
});

router.get(
  "/customers/pending-payouts",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const rmId = req.user.sub;

      // Fetch all applications under this RM
      const applications = await Application.find({ rmId })
        .populate("customerId", "employeeId firstName lastName email phone")
        .populate("partnerId", "firstName lastName email phone")
        .lean();

      // Get all payouts with DONE
      const donePayouts = await Payout.find({ payOutStatus: "DONE" })
        .select("application")
        .lean();

      const doneAppIds = new Set(
        donePayouts.map((p) => p.application.toString())
      );

      // Only consider applications with DISBURSED and NOT already DONE
      const disbursedApps = applications.filter(
        (app) =>
          app.status === "DISBURSED" && !doneAppIds.has(app._id.toString())
      );

      // Map to customer format
      const customers = disbursedApps.map((app) => ({
        customerId: app.customerId?._id,
        customerEmployeeId: app.customerId?.employeeId || null,
        customerName: `${app.customerId?.firstName ?? ""} ${
          app.customerId?.lastName ?? ""
        }`.trim(),
        contact: app.customerId?.phone || null,
        email: app.customerId?.email || null,
        loanType: app.loanType,
        requestedAmount: app.customer?.loanAmount || null,
        approvedAmount: app.approvedLoanAmount || null,
        status: app.status,
        payOutStatus: "PENDING",
        partner: {
          partnerId: app.partnerId?._id,
          name: `${app.partnerId?.firstName ?? ""} ${
            app.partnerId?.lastName ?? ""
          }`.trim(),
          email: app.partnerId?.email,
          phone: app.partnerId?.phone,
        },
        applicationId: app._id,
        createdAt: app.createdAt,
      }));

      return res.json(customers);
    } catch (err) {
      console.error("Error fetching pending payout customers:", err);
      return res
        .status(500)
        .json({ message: "Server error", error: err.message });
    }
  }
);

router.get(
  "/customers/done-payouts",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const rmId = req.user.sub;

      const applications = await Application.find({ rmId })
        .populate("customerId", "employeeId firstName lastName email phone")
        .populate("partnerId", "firstName lastName email phone")
        .lean();

      const appIds = applications.map((app) => app._id);

      const donePayouts = await Payout.find({
        application: { $in: appIds },
        payOutStatus: "DONE",
      })
        .select("application payOutStatus")
        .lean();

      const doneMap = {};
      donePayouts.forEach((p) => {
        doneMap[p.application.toString()] = p.payOutStatus;
      });

      const customers = applications
        .filter((app) => doneMap[app._id.toString()]) // only apps with DONE payout
        .map((app) => ({
          customerId: app.customerId?._id,
          customerEmployeeId: app.customerId?.employeeId || null,
          customerName: `${app.customerId?.firstName ?? ""} ${
            app.customerId?.lastName ?? ""
          }`.trim(),
          contact: app.customerId?.phone || null,
          email: app.customerId?.email || null,
          loanType: app.loanType,
          requestedAmount: app.customer?.loanAmount || null,
          approvedAmount: app.approvedLoanAmount || null,
          status: app.status,
          payOutStatus: "DONE",
          partner: {
            partnerId: app.partnerId?._id,
            name: `${app.partnerId?.firstName ?? ""} ${
              app.partnerId?.lastName ?? ""
            }`.trim(),
            email: app.partnerId?.email,
            phone: app.partnerId?.phone,
          },
          applicationId: app._id,
          createdAt: app.createdAt,
        }));

      return res.json(customers);
    } catch (err) {
      console.error("Error fetching done payout customers:", err);
      return res
        .status(500)
        .json({ message: "Server error", error: err.message });
    }
  }
);

// ✅ Get full loan application details (everything from schema)
// router.get(
//   "/customers/:customerId/applications/:applicationId",
//   auth,
//   requireRole(ROLES.RM),
//   async (req, res) => {
//     try {
//       const rmId = req.user.sub; // RM logged in
//       const { customerId, applicationId } = req.params;

//       // Find the full application belonging to this RM + Customer
//       const application = await Application.findOne({
//         _id: applicationId,
//         rmId,
//         customerId,
//       })
//         .populate("customerId", "firstName lastName email phone") // 👤 User-level info
//         .populate("partnerId", "firstName lastName email phone") // 👔 Partner info
//         .populate("rmId", "firstName lastName email phone") // 🧑‍💼 RM info
//         .populate("docs.uploadedBy", "firstName lastName email") // 📄 Who uploaded documents
//         .lean();

//       if (!application) {
//         return res.status(404).json({
//           message: "Application not found or not assigned to this RM",
//         });
//       }

//       return res.json(application);
//     } catch (err) {
//       console.error("Error fetching full application details:", err);
//       return res
//         .status(500)
//         .json({ message: "Error fetching application details" });
//     }
//   }
// );

router.get(
  "/customers/:customerId/applications/:applicationId",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const rmId = req.user.sub; // RM logged in
      const { customerId, applicationId } = req.params;

      // Find the full application belonging to this RM + Customer
      const application = await Application.findOne({
        _id: applicationId,
        rmId,
        customerId,
      })
        .populate("customerId", "firstName lastName email phone") // 👤 User-level info
        .populate("partnerId", "firstName lastName email phone") // 👔 Partner info
        .populate("rmId", "firstName lastName email phone") // 🧑‍💼 RM info
        .populate("docs.uploadedBy", "firstName lastName email") // 📄 Who uploaded documents
        .lean();

      if (!application) {
        return res.status(404).json({
          message: "Application not found or not assigned to this RM",
        });
      }

      const backendUrl = process.env.BACKEND_URL || "http://localhost:5000";

      // Prepend backend URL to all docs
      if (application.docs && application.docs.length) {
        application.docs = application.docs.map((doc) => ({
          ...doc,
          url: doc.url.startsWith("http") ? doc.url : `${backendUrl}/${doc.url}`,
        }));
      }

      return res.json(application);
    } catch (err) {
      console.error("Error fetching full application details:", err);
      return res
        .status(500)
        .json({ message: "Error fetching application details" });
    }
  }
);


// router.get(
//   "/applications/:id/docs/:docType/download",
//   auth,
//   requireRole(ROLES.RM),
//   async (req, res) => {
//     try {
//       const { id, docType } = req.params;
//       const app = await Application.findById(id).lean();

//       if (!app) {
//         return res.status(404).json({ message: "Application not found" });
//       }

//       const doc = app.docs.find(
//         (d) => d.docType.toUpperCase() === docType.toUpperCase()
//       );
//       if (!doc) {
//         return res.status(404).json({ message: "Document not found" });
//       }

//       // ✅ Resolve file path
//       const filePath = path.resolve(process.cwd(), doc.url);
//       if (!fs.existsSync(filePath)) {
//         return res.status(404).json({ message: "File not found" });
//       }

//       const stats = fs.statSync(filePath);
//       if (!stats.isFile()) {
//         return res.status(404).json({ message: "Path is not a file" });
//       }

//       // ✅ Detect MIME type
//       const fileExtension = path.extname(filePath);
//       const filename = `${docType}${fileExtension}`;
//       const contentType =
//         mime.lookup(fileExtension) || "application/octet-stream";

//       // ✅ Expose Content-Disposition so frontend can read filename
//       res.setHeader(
//         "Content-Disposition",
//         `attachment; filename="${filename}"`
//       );
//       res.setHeader("Content-Type", contentType);
//       res.setHeader("Content-Length", stats.size);
//       res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

//       // ✅ Stream file
//       const fileStream = fs.createReadStream(filePath);
//       fileStream.pipe(res);

//       fileStream.on("error", (err) => {
//         console.error("File stream error:", err);
//         if (!res.headersSent) {
//           res.status(500).json({ message: "Error reading file" });
//         }
//       });
//     } catch (err) {
//       console.error("Download error:", err);
//       if (!res.headersSent) {
//         res.status(500).json({ message: "Error downloading document" });
//       }
//     }
//   }
// );

// Download all documents as ZIP

router.get(
  "/applications/:id/docs/:docType/download",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const { id, docType } = req.params;
      const app = await Application.findById(id).lean();

      if (!app) {
        return res.status(404).json({ message: "Application not found" });
      }

      const doc = app.docs.find(
        (d) => d.docType.toUpperCase() === docType.toUpperCase()
      );
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }

      let fileStream;
      let filename;
      let contentType;

      if (doc.url.startsWith("http")) {
        // 🔹 Remote URL (Render/S3 etc.)
        const response = await axios.get(doc.url, { responseType: "stream" });
        contentType =
          response.headers["content-type"] || "application/octet-stream";
        const ext = path.extname(new URL(doc.url).pathname);
        filename = `${docType}${ext}`;
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.setHeader("Content-Type", contentType);
        response.data.pipe(res);
      } else {
        // 🔹 Local file
        const filePath = path.resolve(process.cwd(), doc.url);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found" });
        }
        const ext = path.extname(filePath);
        filename = `${docType}${ext}`;
        contentType = mime.lookup(ext) || "application/octet-stream";

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.setHeader("Content-Type", contentType);
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (err) {
      console.error("Download error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error downloading document" });
      }
    }
  }
);

// router.get(
//   "/applications/:id/docs/download-all",
//   auth,
//   requireRole(ROLES.RM),
//   async (req, res) => {
//     try {
//       const { id } = req.params;
//       const rmId = req.user.sub;

//       // Find application under this RM
//       const app = await Application.findOne({
//         _id: id,
//         rmId: rmId,
//       }).lean();

//       if (!app) {
//         return res
//           .status(404)
//           .json({ message: "Application not found under this RM" });
//       }

//       if (!app.docs || app.docs.length === 0) {
//         return res
//           .status(404)
//           .json({ message: "No documents found for this application" });
//       }

//       // Create ZIP filename based on application data
//       const zipFilename = `${app.appNo || `APP-${id.slice(-6)}`}_Documents.zip`;

//       // Set response headers for ZIP download
//       res.setHeader("Content-Type", "application/zip");
//       res.setHeader(
//         "Content-Disposition",
//         `attachment; filename="${zipFilename}"`
//       );
//       res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

//       // Create archive
//       const archive = archiver("zip", {
//         zlib: { level: 9 }, // Maximum compression
//       });

//       // Handle archive errors
//       archive.on("error", (err) => {
//         console.error("Archive error:", err);
//         if (!res.headersSent) {
//           res.status(500).json({ message: "Error creating archive" });
//         }
//       });

//       // Pipe archive to response
//       archive.pipe(res);

//       let filesAdded = 0;
//       const errors = [];

//       // Process each document
//       for (let i = 0; i < app.docs.length; i++) {
//         const doc = app.docs[i];

//         try {
//           // Use path.resolve to handle Windows paths properly
//           const filePath = path.resolve(process.cwd(), doc.url);

//           console.log(
//             `Processing document ${i + 1}/${app.docs.length}: ${doc.docType}`
//           );
//           console.log(`File path: ${filePath}`);

//           if (fs.existsSync(filePath)) {
//             const stats = fs.statSync(filePath);

//             if (stats.isFile()) {
//               // Create clean filename: docType + original extension
//               const fileExtension = path.extname(doc.url);
//               const cleanFilename = `${doc.docType}${fileExtension}`;

//               // Add file to archive
//               archive.file(filePath, { name: cleanFilename });
//               filesAdded++;

//               console.log(
//                 `✓ Added: ${cleanFilename} (${(stats.size / 1024).toFixed(
//                   1
//                 )}KB)`
//               );
//             } else {
//               errors.push(`${doc.docType}: Path exists but is not a file`);
//               console.log(`✗ ${doc.docType}: Not a file`);
//             }
//           } else {
//             errors.push(`${doc.docType}: File not found at ${doc.url}`);
//             console.log(`✗ ${doc.docType}: File not found`);
//           }
//         } catch (error) {
//           errors.push(`${doc.docType}: ${error.message}`);
//           console.error(`✗ Error processing ${doc.docType}:`, error.message);
//         }
//       }

//       // Check if any files were added
//       if (filesAdded === 0) {
//         archive.destroy();
//         return res.status(404).json({
//           message: "No valid documents found to download",
//           errors: errors,
//           totalDocs: app.docs.length,
//         });
//       }

//       // Add summary file if there were any errors
//       if (errors.length > 0) {
//         const summaryContent = [
//           `Download Summary for Application: ${app.appNo}`,
//           `Customer: ${app.customer?.name || "N/A"}`,
//           `Partner: ${app.partner?.name || "N/A"}`,
//           `Generated: ${new Date().toLocaleString()}`,
//           "",
//           `Total Documents: ${app.docs.length}`,
//           `Successfully Downloaded: ${filesAdded}`,
//           `Failed Downloads: ${errors.length}`,
//           "",
//           "Failed Downloads:",
//           ...errors.map((error, idx) => `${idx + 1}. ${error}`),
//           "",
//           "Note: Only successfully found documents are included in this ZIP file.",
//         ].join("\n");

//         archive.append(summaryContent, { name: "DOWNLOAD_SUMMARY.txt" });
//       }

//       // Finalize the archive (this triggers the download)
//       await archive.finalize();

//       console.log(
//         `✓ ZIP archive created successfully with ${filesAdded} files`
//       );
//     } catch (err) {
//       console.error("Download all documents error:", err);
//       if (!res.headersSent) {
//         res.status(500).json({ message: "Error creating document archive" });
//       }
//     }
//   }
// );

// GET /rm/profile

router.get(
  "/applications/:id/docs/download-all",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const { id } = req.params;
      const rmId = req.user.sub;

      const app = await Application.findOne({ _id: id, rmId }).lean();
      if (!app) {
        return res
          .status(404)
          .json({ message: "Application not found under this RM" });
      }
      if (!app.docs?.length) {
        return res.status(404).json({ message: "No documents found" });
      }

      const zipFilename = `${app.appNo || `APP-${id.slice(-6)}`}_Documents.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${zipFilename}"`
      );
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      for (const doc of app.docs) {
        try {
          let ext;
          let cleanFilename;

          if (doc.url.startsWith("http")) {
            // 🔹 Remote fetch
            const response = await axios.get(doc.url, { responseType: "stream" });
            ext = path.extname(new URL(doc.url).pathname) || "";
            cleanFilename = `${doc.docType}${ext}`;
            archive.append(response.data, { name: cleanFilename });
          } else {
            // 🔹 Local file
            const filePath = path.resolve(process.cwd(), doc.url);
            if (fs.existsSync(filePath)) {
              ext = path.extname(filePath);
              cleanFilename = `${doc.docType}${ext}`;
              archive.file(filePath, { name: cleanFilename });
            }
          }
        } catch (error) {
          console.error(`Error processing ${doc.docType}:`, error.message);
        }
      }

      await archive.finalize();
    } catch (err) {
      console.error("Download all documents error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error creating document archive" });
      }
    }
  }
);

router.get("/profile", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const rm = await User.findById(req.user.sub)
      .select("-passwordHash")
      .populate({
        path: "asmId",
        select: "firstName lastName employeeId region phone",
      })
      .lean();

    if (!rm) {
      return res.status(404).json({ message: "RM not found" });
    }

    // ✅ Generate referral link using rmCode
    const referralLink = `${
      process.env.BASE_URL || "http://localhost:" + process.env.PORT
    }/api/rm/partner/register-by-rmcode?ref=${rm.rmCode}`;

    res.json({
      employeeId: rm.employeeId,
      firstName: rm.firstName,
      lastName: rm.lastName,
      email: rm.email,
      phone: rm.phone,
      dob: rm.dob,
      address: rm.address,
      experience: rm.experience,
      region: rm.region,
      status: rm.status,
      rmCode: rm.rmCode,
      JoiningDate: rm.createdAt,

      // ✅ new field
      referralLink,

      // Flattened ASM details
      asmId: rm.asmId?._id || null,
      asmName: rm.asmId ? `${rm.asmId.firstName} ${rm.asmId.lastName}` : null,
      asmEmployeeId: rm.asmId?.employeeId || null,
      asmRegion: rm.asmId?.region || null,
      asmPhone: rm.asmId?.phone || null,
    });
  } catch (err) {
    console.error("Error fetching RM profile:", err);
    res.status(500).json({ message: err.message });
  }
});

// PATCH /rm/profile/update
router.patch(
  "/profile/update",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const rmId = req.user.sub; // RM id from token

      const {
        firstName,
        lastName,
        email,
        phone,
        dob,
        address,
        experience,
        region,
        bankName,
        accountNumber,
        ifscCode,
        accountHolderName,
      } = req.body;

      const updateData = {
        firstName,
        lastName,
        email,
        phone,
        dob,
        address,
        experience,
        region,
        bankName,
        accountNumber,
        ifscCode,
        accountHolderName,
      };

      // Remove undefined values
      Object.keys(updateData).forEach(
        (key) => updateData[key] === undefined && delete updateData[key]
      );

      const updatedRm = await User.findOneAndUpdate(
        { _id: rmId, role: ROLES.RM },
        { $set: updateData },
        { new: true, runValidators: true, projection: "-passwordHash" }
      );

      if (!updatedRm) return res.status(404).json({ message: "RM not found" });

      res.json({ message: "Profile updated successfully", profile: updatedRm });
    } catch (err) {
      console.error("Error updating RM profile:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

// POST /target/assign-partner-bulk
router.post(
  "/target/assign-partner-bulk",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      let { month, year, totalTarget } = req.body;

      if (!month || !year || !totalTarget) {
        return res
          .status(400)
          .json({ message: "Month, year, and totalTarget are required" });
      }

      // Convert totalTarget to number
      totalTarget = Number(totalTarget);
      year = Number(year);

      // Map month name to number
      const monthMap = {
        January: 1,
        February: 2,
        March: 3,
        April: 4,
        May: 5,
        June: 6,
        July: 7,
        August: 8,
        September: 9,
        October: 10,
        November: 11,
        December: 12,
      };

      if (typeof month === "string") {
        month = monthMap[month];
      }

      // Validate month
      if (!month || month < 1 || month > 12) {
        return res.status(400).json({ message: "Invalid month value" });
      }

      const rmId = req.user.sub; // logged-in RM ID

      // Get all partners under this RM
      const partners = await User.find({
        role: ROLES.PARTNER,
        rmId: rmId,
      }).lean();

      if (!partners.length) {
        return res
          .status(404)
          .json({ message: "No Partners found under this RM" });
      }

      const perPartnerTarget = Math.floor(totalTarget / partners.length);
      const bulkAssignments = [];

      for (let partner of partners) {
        let target = await Target.findOne({
          assignedTo: partner._id,
          month,
          year,
          role: ROLES.PARTNER,
        });

        if (target) {
          target.targetValue = perPartnerTarget;
          target.assignedBy = rmId;
          await target.save();
          bulkAssignments.push(target);
        } else {
          const newTarget = await Target.create({
            assignedBy: rmId,
            assignedTo: partner._id,
            role: ROLES.PARTNER,
            month,
            year,
            targetValue: perPartnerTarget,
          });
          bulkAssignments.push(newTarget);
        }
      }

      res.status(201).json({
        message:
          "Bulk target assigned successfully to all Partners under this RM",
        totalTarget,
        perPartnerTarget,
        month, // number (1-12)
        year,
        assignments: bulkAssignments,
      });
    } catch (err) {
      console.error("Assign Partner bulk error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Universal analytics/dashboard API with user profile
router.get("/:id/analytics", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    // Helper functions
    const sumDisbursedBy = async (filter) => {
      const agg = await Application.aggregate([
        { $match: { ...filter, status: "DISBURSED" } },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: "$approvedLoanAmount" } },
          },
        },
      ]);
      return agg.length > 0 ? Number(agg[0].total) : 0;
    };

    const getAssignedTarget = async (userId, role) => {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      const t = await Target.findOne({
        assignedTo: userId,
        role,
        month: currentMonth,
        year: currentYear,
      });
      return t ? Number(t.targetValue) : 0;
    };

    // Base profile
    const base = {
      userId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      role: user.role,
      email: user.email,
      phone: user.phone,
      employeeId: user.employeeId || null,
      dob: user.dob || null,
      address: user.address || null,
      experience: user.experience || null,
      region: user.region || null,
      asmCode: user.asmCode || null,
      rmCode: user.rmCode || null,
      partnerCode: user.partnerCode || null,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    let totals = {};
    let totalDisbursed = 0;
    let performance = "0.00";
    let assignedTargetValue = 0;
    let scope = user.role;

    // ================= ROLE LOGIC =================
    switch (user.role) {
      case ROLES.ASM: {
        const rms = await User.find({ asmId: id, role: ROLES.RM })
          .select("_id")
          .lean();
        const rmIds = rms.map((x) => x._id);

        const partners = await User.find({
          rmId: { $in: rmIds },
          role: ROLES.PARTNER,
        })
          .select("_id")
          .lean();
        const partnerIds = partners.map((x) => x._id);

        const customers = await Application.distinct("customerId", {
          partnerId: { $in: partnerIds },
        });

        totalDisbursed = await sumDisbursedBy({
          partnerId: { $in: partnerIds },
        });
        assignedTargetValue = await getAssignedTarget(user._id, ROLES.ASM);

        performance =
          assignedTargetValue > 0
            ? ((totalDisbursed / assignedTargetValue) * 100).toFixed(2)
            : "0.00";

        totals = {
          rms: rmIds.length,
          partners: partnerIds.length,
          customers: customers.length,
        };
        break;
      }

      case ROLES.RM: {
        const partners = await User.find({ rmId: id, role: ROLES.PARTNER })
          .select("_id")
          .lean();
        const partnerIds = partners.map((x) => x._id);

        const customers = await Application.distinct("customerId", {
          partnerId: { $in: partnerIds },
        });

        totalDisbursed = await sumDisbursedBy({ rmId: user._id });
        assignedTargetValue = await getAssignedTarget(user._id, ROLES.RM);

        performance =
          assignedTargetValue > 0
            ? ((totalDisbursed / assignedTargetValue) * 100).toFixed(2)
            : "0.00";

        totals = { partners: partnerIds.length, customers: customers.length };
        break;
      }

      case ROLES.PARTNER: {
        const customers = await Application.distinct("customerId", {
          partnerId: user._id,
        });

        totalDisbursed = await sumDisbursedBy({ partnerId: user._id });
        assignedTargetValue = await getAssignedTarget(user._id, ROLES.PARTNER);

        performance =
          assignedTargetValue > 0
            ? ((totalDisbursed / assignedTargetValue) * 100).toFixed(2)
            : "0.00";

        totals = { customers: customers.length };
        break;
      }

      case ROLES.CUSTOMER: {
        totalDisbursed = await sumDisbursedBy({ customerId: user._id });
        assignedTargetValue = 0;
        performance = undefined;
        totals = {};
        break;
      }
    }

    // ============== RESPONSE =================
    return res.json({
      profile: base,
      analytics: {
        scope,
        totals,
        assignedTarget: assignedTargetValue,
        totalDisbursed,
        performance:
          scope === ROLES.ASM || scope === ROLES.RM || scope === ROLES.PARTNER
            ? `${performance}%`
            : undefined,
      },
    });
  } catch (err) {
    console.error("Universal analytics error:", err);
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

router.get(
  "/customer/:customerId/partners-payout",
  auth,
  requireRole(ROLES.RM),
  async (req, res) => {
    try {
      const { customerId } = req.params;

      // Find all applications for this customer
      const applications = await Application.find({ customerId })
        .select("_id partnerId approvedLoanAmount status")
        .lean();

      if (!applications.length) {
        return res
          .status(404)
          .json({ message: "No partners found for this customer" });
      }

      // Get unique partner IDs
      const partnerIds = [
        ...new Set(applications.map((app) => app.partnerId.toString())),
      ];

      // Fetch partner details
      const partnersData = await User.find({ _id: { $in: partnerIds } })
        .select(
          "firstName lastName email phone bankName accountNumber ifscCode accountHolderName"
        )
        .lean();

      // Fetch payouts for these applications
      const appIds = applications.map((app) => app._id);
      const payouts = await Payout.find({ application: { $in: appIds } })
        .select("application partnerId status")
        .lean();

      // Map partner details + application info + payout status
      const partners = partnersData.map((partner) => {
        // Find all applications for this partner for this customer
        const apps = applications.filter(
          (app) => app.partnerId.toString() === partner._id.toString()
        );

        // Pick latest application
        const latestApp = apps[apps.length - 1];

        // Find payout for this application if exists
        const payout = payouts.find(
          (p) =>
            p.application.toString() === latestApp._id.toString() &&
            p.partnerId.toString() === partner._id.toString()
        );

        return {
          _id: partner._id,
          firstName: partner.firstName,
          lastName: partner.lastName,
          email: partner.email,
          phone: partner.phone,
          accountHolderName: partner.accountHolderName,
          accountNumber: partner.accountNumber,
          bankName: partner.bankName,
          ifscCode: partner.ifscCode,
          approvedLoanAmount: latestApp.approvedLoanAmount || 0,
          payoutStatus: payout?.status || "PENDING",
          applicationId: appIds[0],
        };
      });

      return res.json({
        customerId,
        partners,
      });
    } catch (err) {
      console.error("Error fetching partners for customer with payout:", err);
      return res
        .status(500)
        .json({ message: "Server error", error: err.message });
    }
  }
);

// POST /rm/payouts
router.post("/set-payouts", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const { applicationId, partnerId, payoutPercentage, note, payOutStatus } =
      req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    // Fetch application
    const application = await Application.findById(applicationId).select(
      "approvedLoanAmount partnerId"
    );
    if (!application) {
      return res.status(404).json({ message: "Application not found" });
    }

    // Ensure partner matches
    if (application.partnerId.toString() !== partnerId) {
      return res
        .status(400)
        .json({ message: "Application does not belong to this partner" });
    }

    // Calculate payout amount
    let payoutAmount = 0;
    if (payoutPercentage) {
      payoutAmount = (application.approvedLoanAmount * payoutPercentage) / 100;
    }

    // Check if payout already exists
    let payout = await Payout.findOne({
      application: applicationId,
      partnerId,
    });

    if (payout) {
      // ✅ Update existing payout
      payout.amount = payoutAmount || payout.amount;
      payout.note = note || payout.note;
      if (payOutStatus && ["PENDING", "DONE"].includes(payOutStatus)) {
        payout.payOutStatus = payOutStatus;
      }
      await payout.save();
    } else {
      // ✅ Create new payout
      payout = await Payout.create({
        application: applicationId,
        partnerId,
        amount: payoutAmount,
        note,
        payOutStatus:
          payOutStatus && ["PENDING", "DONE"].includes(payOutStatus)
            ? payOutStatus
            : "PENDING",
        addedBy: req.user.sub, // RM user
      });
    }

    return res.status(201).json({
      message: "Payout saved successfully",
      payout,
    });
  } catch (err) {
    console.error("Error saving payout:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
});


// router.get(
//   "/partner-reports",
//   auth,
//   requireRole(ROLES.RM),
//   async (req, res) => {
//     try {
//       const rmId = req.user.sub;

//       // Fetch partners under RM
//       const partners = await User.find({ rmId, role: ROLES.PARTNER }).lean();

//       const now = new Date();
//       const month = now.getMonth() + 1;
//       const year = now.getFullYear();

//       const partnerReports = await Promise.all(
//         partners.map(async (p) => {
//           // Count applications by status
//           const totalApplications = await Application.countDocuments({
//             partnerId: p._id,
//           });
//           const approvedCount = await Application.countDocuments({
//             partnerId: p._id,
//             status: "APPROVED",
//           });
//           const disbursedCount = await Application.countDocuments({
//             partnerId: p._id,
//             status: "DISBURSED",
//           });
//           const rejectedCount = await Application.countDocuments({
//             partnerId: p._id,
//             status: "REJECTED",
//           });

//           // Revenue: sum of approvedLoanAmount for disbursed applications
//           const revenueAgg = await Application.aggregate([
//             { $match: { partnerId: p._id, status: "DISBURSED" } },
//             {
//               $group: {
//                 _id: null,
//                 totalRevenue: { $sum: { $toDouble: "$approvedLoanAmount" } },
//               },
//             },
//           ]);
//           const revenue =
//             revenueAgg.length > 0 ? Number(revenueAgg[0].totalRevenue) : 0;

//           // Target assigned this month
//           const targetDoc = await Target.findOne({
//             assignedTo: p._id,
//             role: ROLES.PARTNER,
//             month,
//             year,
//           });
//           const targetValue = targetDoc ? Number(targetDoc.targetValue) : 0;

//           // Target achieved % based on revenue vs target
//           const targetAchievedPercent =
//             targetValue > 0
//               ? Math.min(100, ((revenue / targetValue) * 100).toFixed(0))
//               : 0;

//           // Target achieved in rupees (actual revenue contributed to target)
//           const targetAchievedAmount = Math.min(revenue, targetValue);

//           // Closed deals = number of disbursed applications (not %)
//           const closedDeals = disbursedCount;

//           return {
//             id: p._id,
//             name: `${p.firstName} ${p.lastName}`,
//             totalApplications,
//             approved: approvedCount,
//             disbursed: disbursedCount,
//             rejected: rejectedCount,
//             revenue, // total revenue from disbursed loans
//             targetValue,
//             targetAchievedPercent,
//             targetAchievedAmount,
//             closedDeals, // ✅ now showing as a count
//           };
//         })
//       );

//       res.json({ success: true, data: partnerReports });
//     } catch (err) {
//       console.error("Partner reports error:", err);
//       res
//         .status(500)
//         .json({ success: false, message: "Failed to fetch partner reports" });
//     }
//   }
// );

// router.get("/partner-reports", auth, requireRole(ROLES.RM), async (req, res) => {
//   try {
//     const rmId = req.user.sub;

//     // Fetch partners under RM
//     const partners = await User.find({ rmId, role: ROLES.PARTNER }).lean();
//     const now = new Date();
//     const month = now.getMonth() + 1;
//     const year = now.getFullYear();

//     // Fetch RM's target for this month
//     const rmTargetDoc = await Target.findOne({
//       assignedTo: rmId,
//       role: ROLES.RM,
//       month,
//       year,
//     });
//     const rmMonthlyTarget = rmTargetDoc ? Number(rmTargetDoc.targetValue) : 0;

//     const partnerReports = await Promise.all(
//       partners.map(async (p) => {
//         // Count applications by status
//         const totalApplications = await Application.countDocuments({ partnerId: p._id });
//         const approvedCount = await Application.countDocuments({ partnerId: p._id, status: "APPROVED" });
//         const disbursedCount = await Application.countDocuments({ partnerId: p._id, status: "DISBURSED" });
//         const rejectedCount = await Application.countDocuments({ partnerId: p._id, status: "REJECTED" });

//         // Revenue: sum of approvedLoanAmount for disbursed applications
//         const revenueAgg = await Application.aggregate([
//           { $match: { partnerId: p._id, status: "DISBURSED" } },
//           { $group: { _id: null, totalRevenue: { $sum: { $toDouble: "$approvedLoanAmount" } } } },
//         ]);
//         const revenue = revenueAgg.length > 0 ? Number(revenueAgg[0].totalRevenue) : 0;

//         // Assign monthly target proportionally to partner
//         const targetValue = partners.length > 0 ? Number((rmMonthlyTarget / partners.length).toFixed(2)) : 0;

//         // Target achieved % based on revenue vs target
//         const targetAchievedPercent = targetValue > 0 ? Math.min(100, ((revenue / targetValue) * 100).toFixed(0)) : 0;

//         // Target achieved amount
//         const targetAchievedAmount = Math.min(revenue, targetValue);

//         // Closed deals = number of disbursed applications
//         const closedDeals = disbursedCount;

//         return {
//           id: p._id,
//           name: `${p.firstName} ${p.lastName}`,
//           totalApplications,
//           approved: approvedCount,
//           disbursed: disbursedCount,
//           rejected: rejectedCount,
//           revenue,
//           targetValue,
//           targetAchievedPercent,
//           targetAchievedAmount,
//           closedDeals,
//         };
//       })
//     );

//     res.json({ success: true, data: partnerReports });
//   } catch (err) {
//     console.error("Partner reports error:", err);
//     res.status(500).json({ success: false, message: "Failed to fetch partner reports" });
//   }
// });


router.get("/partner-reports", auth, requireRole(ROLES.RM), async (req, res) => {
  try {
    const rmId = req.user.sub;

    // Fetch partners under RM
    const partners = await User.find({ rmId, role: ROLES.PARTNER }).lean();
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Fetch RM's monthly target
    const rmTargetDoc = await Target.findOne({
      assignedTo: rmId,
      role: ROLES.RM,
      month,
      year,
    });
    const rmMonthlyTarget = rmTargetDoc ? Number(rmTargetDoc.targetValue) : 0;

    // Fetch all partner targets for this RM
    const partnerTargetDocs = await Target.find({
      assignedTo: { $in: partners.map(p => p._id) },
      role: ROLES.PARTNER,
      month,
      year,
    });

    const partnerReports = await Promise.all(
      partners.map(async (p) => {
        // Count applications by status
        const totalApplications = await Application.countDocuments({ partnerId: p._id });
        const approvedCount = await Application.countDocuments({ partnerId: p._id, status: "APPROVED" });
        const disbursedCount = await Application.countDocuments({ partnerId: p._id, status: "DISBURSED" });
        const rejectedCount = await Application.countDocuments({ partnerId: p._id, status: "REJECTED" });

        // Revenue: sum of approvedLoanAmount for disbursed applications
        const revenueAgg = await Application.aggregate([
          { $match: { partnerId: p._id, status: "DISBURSED" } },
          { $group: { _id: null, totalRevenue: { $sum: { $toDouble: "$approvedLoanAmount" } } } },
        ]);
        const revenue = revenueAgg.length > 0 ? Number(revenueAgg[0].totalRevenue) : 0;

        // Partner target: use assigned target if exists, otherwise assign proportion of RM target
        const partnerTargetDoc = partnerTargetDocs.find(t => t.assignedTo.toString() === p._id.toString());
        const targetValue = partnerTargetDoc
          ? Number(partnerTargetDoc.targetValue)
          : partners.length > 0
          ? Number((rmMonthlyTarget / partners.length).toFixed(2))
          : 0;

        // Target achieved
        const targetAchievedPercent = targetValue > 0
          ? Math.min(100, ((revenue / targetValue) * 100).toFixed(0))
          : 0;

        const targetAchievedAmount = Math.min(revenue, targetValue);

        return {
          id: p._id,
          name: `${p.firstName} ${p.lastName}`,
          totalApplications,
          approved: approvedCount,
          disbursed: disbursedCount,
          rejected: rejectedCount,
          revenue,
          targetValue,
          targetAchievedPercent,
          targetAchievedAmount,
          closedDeals: disbursedCount,
        };
      })
    );

    res.json({ success: true, data: partnerReports });
  } catch (err) {
    console.error("Partner reports error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch partner reports" });
  }
});


export default router;
