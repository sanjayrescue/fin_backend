import express from "express";
import { contactFunction } from "../controllers/contactController.js";

const router = express.Router();

// POST /api/contact
router.post("/", contactFunction);

export default router;
