import mongoose from "mongoose";

const bankDetailsSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  bankName: { type: String, required: true },
  accountHolderName: { type: String, required: true },
  accountNumber: { type: String, required: true },
  ifscCode: { type: String, required: true },
  registeredMobile: { type: String },
  status: { type: String, enum: ["PENDING", "VERIFIED", "REJECTED"], default: "PENDING" }
}, { timestamps: true });

export const BankDetails = mongoose.model("BankDetails", bankDetailsSchema);
