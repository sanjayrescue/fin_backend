// models/Banner.js
import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true }, // store path
    title: { type: String }, // optional - in case you want caption
    description: { type: String }, // optional
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Banner = mongoose.model("Banner", bannerSchema);
