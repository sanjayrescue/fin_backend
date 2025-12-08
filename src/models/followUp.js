import mongoose from "mongoose";

const followUpSchema = new mongoose.Schema({
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["Connected", "Ringing", "Switch Off", "Not Reachable"], default: "Not Reachable" },
    remarks: { type: String },
    lastCall: { type: Date },  // date & time of last follow-up
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // RM who updated
  }, { timestamps: true });
  
  export const FollowUp = mongoose.model("FollowUp", followUpSchema);
  