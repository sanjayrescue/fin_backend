// utils/generateEmployeeId.js
import { User } from "../models/User.js";
import { Application } from "../models/Application.js";

export async function generateEmployeeId(role) {
  let prefix;
  let last;

  switch (role) {
    case "ASM":
      prefix = "TLA";
      last = await User.find({ role })
        .sort({ createdAt: -1 })
        .limit(1)
        .select("employeeId");
      break;

    case "RM":
      prefix = "TLR";
      last = await User.find({ role })
        .sort({ createdAt: -1 })
        .limit(1)
        .select("employeeId");
      break;

    case "PARTNER":
      prefix = "TLP";
      last = await User.find({ role })
        .sort({ createdAt: -1 })
        .limit(1)
        .select("employeeId");
      break;

    case "CUSTOMER":
      prefix = "TLC";
      last = await User.find({ role })
        .sort({ createdAt: -1 })
        .limit(1)
        .select("employeeId");
      break;

    case "APPLICATION":
      prefix = "TLF";
      last = await Application.find()
        .sort({ createdAt: -1 })
        .limit(1)
        .select("appNo");
      break;

    default:
      throw new Error("Invalid role for employee ID");
  }

  // Determine next number
  let nextNum = 1;
  if (last.length) {
    if (last[0].employeeId) {
      nextNum = parseInt(last[0].employeeId.slice(3)) + 1;
    } else if (last[0].appNo) {
      nextNum = parseInt(last[0].appNo.slice(3)) + 1;
    }
  }

  return `${prefix}${nextNum.toString().padStart(4, "0")}`;
}
