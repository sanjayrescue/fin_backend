import mongoose from "mongoose";

const payoutSchema = new mongoose.Schema(
  {
    application: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Application", 
      required: true 
    },
    partnerId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    }, // denormalized for fast access
    amount: { 
      type: Number, 
      required: true 
    },
    payOutStatus: { 
      type: String, 
      enum: ["PENDING", "DONE"], 
      default: "PENDING" 
    },
    note: { 
      type: String, 
      trim: true 
    },
    addedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
  },
  { timestamps: true }
);

export const Payout = mongoose.model("Payout", payoutSchema);
