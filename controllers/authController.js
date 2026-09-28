import jwt from "jsonwebtoken";
import User from "../models/User.js";

const signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

// "none" is required for the cookie to be sent on a cross-origin request
// (the deployed client is a different origin than this API) — but "none"
// is only valid on a secure (HTTPS) cookie, hence both being tied to
// NODE_ENV === "production" together. Locally, client and server are
// same-origin via Vite's dev proxy, so "lax" over plain HTTP still works.
const cookieOptions = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  secure: process.env.NODE_ENV === "production",
  // Modern browsers may partition cross-site cookies. Marking the production
  // cookie as partitioned lets it remain usable when the client and API are
  // hosted on different sites.
  partitioned: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000,
};

export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  const user = await User.findOne({ username: username.toLowerCase().trim() }).select("+password");
  if (!user) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  if (!user.active) {
    return res.status(403).json({ message: "This account has been deactivated." });
  }

  const token = signToken(user);
  res.cookie("token", token, cookieOptions);
  res.json({ user: user.toSessionJSON() });
};

export const logout = (req, res) => {
  res.clearCookie("token", { ...cookieOptions, maxAge: undefined });
  res.json({ message: "Logged out" });
};

export const me = (req, res) => {
  res.json({ user: req.user.toSessionJSON() });
};
