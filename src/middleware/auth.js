import { verifyAccessToken } from "../utils/jwt.js";

export function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Missing token" });
    const decoded = verifyAccessToken(token);
    if (!decoded?.sub) return res.status(401).json({ message: "Invalid token" });
    req.user = decoded; // { sub, role }
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}
