import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isValidEmail, normalizeEmail, passwordValidationMessage } from "../utils/userCredentials.js";

const PIN_PATTERN = /^\d{6}$/;
const PIN_CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;
const isValidPin = (value) => typeof value === "string" && PIN_PATTERN.test(value);

const signSessionToken = (user) =>
  jwt.sign({ id: user._id, role: user.role, purpose: "session" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

const signPinChallenge = (user, mode) =>
  jwt.sign({ id: user._id, purpose: "pin_challenge", mode }, process.env.JWT_SECRET, {
    expiresIn: "5m",
  });

// "none" is required for the cookie to be sent on a cross-origin request
// (the deployed client is a different origin than this API) — but "none"
// is only valid on a secure (HTTPS) cookie, hence both being tied to
// NODE_ENV === "production" together. Locally, client and server are
// same-origin via Vite's dev proxy, so "lax" over plain HTTP still works.
const sharedCookieOptions = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  secure: process.env.NODE_ENV === "production",
  // Modern browsers may partition cross-site cookies. Marking production
  // cookies as partitioned keeps them usable across the deployed origins.
  partitioned: process.env.NODE_ENV === "production",
};

const sessionCookieOptions = {
  ...sharedCookieOptions,
  maxAge: 8 * 60 * 60 * 1000,
};

const pinChallengeCookieOptions = {
  ...sharedCookieOptions,
  path: "/api/auth",
  maxAge: PIN_CHALLENGE_MAX_AGE_MS,
};

const clearOptions = ({ maxAge: _maxAge, ...options }) => options;

const clearSessionCookie = (res) => {
  res.clearCookie("token", clearOptions(sessionCookieOptions));
};

const clearPinChallengeCookie = (res) => {
  res.clearCookie("pin_challenge", clearOptions(pinChallengeCookieOptions));
};

const completeSignIn = (res, user) => {
  clearPinChallengeCookie(res);
  res.cookie("token", signSessionToken(user), sessionCookieOptions);
  return res.json({ user: user.toSessionJSON() });
};

const readPinChallenge = (req, expectedMode) => {
  const token = req.cookies?.pin_challenge;
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.purpose !== "pin_challenge" || decoded.mode !== expectedMode || !decoded.id) return null;
  return decoded;
};

const requirePinChallenge = (req, res, mode) => {
  try {
    const challenge = readPinChallenge(req, mode);
    if (challenge) return challenge;
  } catch {
    // Expired, malformed, or incorrectly signed challenges all receive the
    // same response so authentication details are not disclosed.
  }
  clearPinChallengeCookie(res);
  res.status(401).json({ message: "Your sign-in verification expired. Sign in again." });
  return null;
};

export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  const user = await User.findOne({ username: username.toLowerCase().trim() }).select("+password +pinHash");
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

  clearSessionCookie(res);
  const mode = user.pinHash ? "verify" : "setup";
  res.cookie("pin_challenge", signPinChallenge(user, mode), pinChallengeCookieOptions);
  return res.json(mode === "setup" ? { requiresPinSetup: true } : { requiresPin: true });
};

export const setupPin = async (req, res) => {
  const { pin, pinConfirmation } = req.body;
  if (!isValidPin(pin)) {
    return res.status(400).json({ message: "PIN must be exactly 6 digits." });
  }
  if (pin !== pinConfirmation) {
    return res.status(400).json({ message: "PIN confirmation does not match." });
  }

  const challenge = requirePinChallenge(req, res, "setup");
  if (!challenge) return undefined;

  const user = await User.findById(challenge.id).select("+pinHash");
  if (!user || !user.active || user.pinHash) {
    clearPinChallengeCookie(res);
    return res.status(401).json({ message: "Unable to create the PIN. Sign in again." });
  }

  await user.setPin(pin);
  await user.save();
  return completeSignIn(res, user);
};

export const verifyPin = async (req, res) => {
  const { pin } = req.body;
  if (!isValidPin(pin)) {
    return res.status(400).json({ message: "PIN must be exactly 6 digits." });
  }

  const challenge = requirePinChallenge(req, res, "verify");
  if (!challenge) return undefined;

  const user = await User.findById(challenge.id).select("+pinHash");
  if (!user || !user.active || !user.pinHash || !(await user.comparePin(pin))) {
    return res.status(401).json({ message: "Invalid PIN." });
  }

  return completeSignIn(res, user);
};

export const resetPassword = async (req, res) => {
  const { email, pin, newPassword, passwordConfirmation } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  if (!isValidPin(pin)) {
    return res.status(400).json({ message: "PIN must be exactly 6 digits." });
  }
  if (newPassword !== passwordConfirmation) {
    return res.status(400).json({ message: "Password confirmation does not match." });
  }

  const passwordError = passwordValidationMessage(newPassword, { email: normalizedEmail });
  if (passwordError) return res.status(400).json({ message: passwordError });

  const user = await User.findOne({ email: normalizedEmail }).select("+pinHash +password");
  if (!user || !user.active || !user.pinHash || !(await user.comparePin(pin))) {
    return res.status(401).json({ message: "Email or PIN is incorrect." });
  }
  const personalizedPasswordError = passwordValidationMessage(newPassword, {
    username: user.username,
    email: user.email,
  });
  if (personalizedPasswordError) return res.status(400).json({ message: personalizedPasswordError });
  if (await user.comparePassword(newPassword)) {
    return res.status(400).json({ message: "New password must be different from the current password." });
  }

  user.password = newPassword;
  await user.save();
  clearSessionCookie(res);
  clearPinChallengeCookie(res);
  return res.json({ message: "Password updated. Sign in with your new password." });
};

export const logout = (req, res) => {
  clearSessionCookie(res);
  clearPinChallengeCookie(res);
  res.json({ message: "Logged out" });
};

export const me = (req, res) => {
  res.json({ user: req.user.toSessionJSON() });
};
