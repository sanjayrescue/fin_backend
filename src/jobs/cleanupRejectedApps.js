import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import Application from "../models/Application.js";
import User from "../models/User.js";

export const cleanupRejectedApps = async () => {
  try {
    const appsToDelete = await Application.find({ deletedAt: { $lte: new Date() } });

    for (const app of appsToDelete) {
      // Delete uploaded docs
      for (const doc of app.docs) {
        const filePath = path.join(process.cwd(), doc.url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      // Delete user & application
      await User.deleteOne({ _id: app.customerId });
      await Application.deleteOne({ _id: app._id });
      console.log("Deleted application and user:", app._id);
    }
  } catch (err) {
    console.error("Cleanup job error:", err);
  }
};
