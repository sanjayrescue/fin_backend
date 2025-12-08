// models/User.js
import mongoose from "mongoose";
import { ALL_ROLES, ROLES } from "../config/roles.js";
import { FollowUp } from "../models/followUp.js";

// Document sub-schema for dynamic files
const DocumentSchema = new mongoose.Schema(
  {
    docType: { type: String, required: true }, // e.g., SELFIE, AADHAR, PAN
    url: { type: String, required: true }, // file path
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["PENDING", "VERIFIED", "REJECTED"],
      default: "PENDING",
    },
    remarks: { type: String },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // Personal info
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true },
    lastName: { type: String, required: true, trim: true },
    dob: { type: Date },
    gender: { type: String, enum: ["Male", "Female", "Other"] },
    maritalStatus: {
      type: String,
      enum: ["Single", "Married", "Divorced", "Widowed"],
    },
    mothersName: { type: String, trim: true },

    // Contact info
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      match: [/^\d{10}$/, "Please enter a valid 10-digit phone number"],
      trim: true,
    },
    address: { type: String },
    region: { type: String },
    pincode: { type: String },
    homeType: { type: String },
    addressStability: { type: String },
    landmark: { type: String },

    // Employment & Bank info
    employmentType: { type: String },
    experience: { type: String },
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true },
    accountHolderName: { type: String, trim: true },

    // Role & hierarchy
    role: { type: String, enum: ALL_ROLES, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "PENDING", "SUSPENDED"],
      default: "ACTIVE",
    },
    asmId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rmId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Employee identifiers & codes
    employeeId: { type: String, unique: true, sparse: true },
    asmCode: { type: String, unique: true, sparse: true },
    rmCode: { type: String, unique: true, sparse: true },
    partnerCode: { type: String, unique: true, sparse: true },
    aadharNumber: { type: String }, // backward compatibility
    panNumber: { type: String },

    // Uploaded docs
    selfie: { type: String }, // backward compatibility
    adharCard: { type: String }, // backward compatibility
    panCard: { type: String }, // backward compatibility
    docs: [DocumentSchema], // dynamic docs array
    // In User.js
    followUps: [{ type: mongoose.Schema.Types.ObjectId, ref: "FollowUp" }],

    passwordHash: { type: String, required: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

// Virtual helpers
userSchema.virtual("isAdmin").get(function () {
  return this.role === ROLES.SUPER_ADMIN;
});
userSchema.virtual("isAsm").get(function () {
  return this.role === ROLES.ASM;
});
userSchema.virtual("isRm").get(function () {
  return this.role === ROLES.RM;
});
userSchema.virtual("isPartner").get(function () {
  return this.role === ROLES.PARTNER;
});

// TTL index
userSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 0 });
export const User = mongoose.model("User", userSchema);
