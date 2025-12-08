// models/Target.js
import mongoose from "mongoose";
import { ROLES } from "../config/roles.js";

const targetSchema = new mongoose.Schema(
  {
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User",}, // Admin
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User",  }, // ASM
    role: { type: String, enum: [ROLES.ASM, ROLES.RM, ROLES.PARTNER], required: true },
    
    month: { type: Number, required: true }, // 1 = Jan ... 12 = Dec
    year: { type: Number, required: true },

    targetValue: { type: Number, required: true },  // e.g. 200000
    achievedValue: { type: Number, default: 0 },    // auto-updated from disbursements
  },
  { timestamps: true }
);

export const Target = mongoose.model("Target", targetSchema);

