import {
  canAccessAnyPage,
  canAccessPage,
  canAccessPageSection,
  canWritePage,
} from "../utils/pageAccess.js";
import { isGlobalAdmin, isSuperAdmin } from "../utils/roles.js";

export const requireELT = (req, res, next) => {
  if (!isGlobalAdmin(req.user)) {
    return res.status(403).json({ message: "ELT or Super Admin access required" });
  }
  next();
};

export const requireSuperAdmin = (req, res, next) => {
  if (!isSuperAdmin(req.user)) {
    return res.status(403).json({ message: "Super Admin access required" });
  }
  next();
};

export const canAccessDivision = (user, divisionId) => {
  if (!divisionId) return false;
  if (isGlobalAdmin(user)) return true;
  return user.divisionAccess.some((id) => id.toString() === divisionId.toString());
};

export const divisionFilter = (user) => {
  if (isGlobalAdmin(user)) return {};
  return { _id: { $in: user.divisionAccess } };
};

export const canAccessSection = (user, section) =>
  canAccessPageSection(user, section);

export { canAccessPage, canWritePage };

export const requirePageAccess = (page) => (req, res, next) => {
  if (canAccessPage(req.user, page)) return next();
  return res.status(403).json({ message: "Access to this page is required" });
};

export const requireAnyPageAccess = (pages) => (req, res, next) => {
  if (canAccessAnyPage(req.user, pages)) return next();
  return res.status(403).json({ message: "Access to this page is required" });
};

export const requirePageWrite = (page) => (req, res, next) => {
  if (canWritePage(req.user, page)) return next();
  return res.status(403).json({ message: "Read & write access to this page is required" });
};

export const requireAnyPageWrite = (pages) => (req, res, next) => {
  if ((pages || []).some((page) => canWritePage(req.user, page))) return next();
  return res.status(403).json({ message: "Read & write access to this page is required" });
};

export const requireSection = (section) => (req, res, next) => {
  if (canAccessSection(req.user, section)) {
    return next();
  }
  return res.status(403).json({ message: "Access to this section is required" });
};

export const requireAnySection = (sections) => (req, res, next) => {
  if (sections.some((section) => canAccessSection(req.user, section))) {
    return next();
  }
  return res.status(403).json({ message: "Access to this section is required" });
};
