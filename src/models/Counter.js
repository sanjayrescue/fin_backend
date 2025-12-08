// models/Counter.js
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  prefix: { type: String, required: true, unique: true }, // TLA, TLR, TLP, TLC, TLF
  seq: { type: Number, default: 0 }
});

export const Counter = mongoose.model("Counter", counterSchema);
