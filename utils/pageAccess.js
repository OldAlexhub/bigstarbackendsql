export const PAGE_ACCESS_GROUPS = [
  {
    key: "general",
    pages: ["dashboard", "settings.general"],
  },
  {
    key: "master_run_cuts",
    pages: [
      "master_run_cuts.run_cuts",
      "master_run_cuts.drivers",
      "master_run_cuts.vehicles",
      "master_run_cuts.tracker",
    ],
  },
  {
    key: "deployment",
    pages: [
      "deployment.live_schedule",
      "deployment.permanent_osr",
      "deployment.standby_utilization",
      "deployment.issue_log",
      "deployment.client_report",
      "deployment.reporting",
      "deployment.schedule_history",
      "deployment.receiving_requests",
      "deployment.posts",
      "deployment.tracker_log",
    ],
  },
  {
    key: "network_success",
    pages: [
      "network_success.excel_submissions",
      "network_success.performance",
      "network_success.reallocation_requests",
      "network_success.posts",
      "network_success.email_templates",
      "network_success.ld_helper",
      "network_success.tui_helper",
    ],
  },
  {
    key: "customer_service",
    pages: ["customer_service.monthly_counts", "customer_service.analytics"],
  },
  {
    key: "safety",
    pages: ["safety.accidents", "safety.scores", "safety.analytics"],
  },
  {
    key: "operations_reporting",
    pages: [
      "operations_reporting.kpi_tracker",
      "operations_reporting.monthly_dashboard",
      "operations_reporting.cap",
      "operations_reporting.cap_reporting",
    ],
  },
  {
    key: "executive_reporting",
    pages: ["elt_reporting.operations_report", "report_builder", "leaderboard"],
  },
];

export const PAGE_ACCESS = PAGE_ACCESS_GROUPS.flatMap((group) => group.pages);
export const PAGE_ACCESS_LEVELS = ["read", "write"];

const pageAccessSet = new Set(PAGE_ACCESS);
const sectionNames = new Set([
  "master_run_cuts",
  "deployment",
  "network_success",
  "customer_service",
  "safety",
  "operations_reporting",
]);

export const sectionForPage = (page) => {
  const section = String(page || "").split(".")[0];
  return sectionNames.has(section) ? section : null;
};

export const normalizePageAccess = (pages) =>
  Array.isArray(pages) ? [...new Set(pages.filter((page) => pageAccessSet.has(page)))] : undefined;

export const normalizePageAccessLevels = (levels, pages = PAGE_ACCESS) => {
  if (levels === undefined) return undefined;
  const source = levels instanceof Map ? Object.fromEntries(levels) : levels;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const allowedPages = new Set(pages || []);
  return Object.fromEntries(
    Object.entries(source)
      .filter(([page, level]) => allowedPages.has(page) && PAGE_ACCESS_LEVELS.includes(level))
  );
};

export const sectionsForPageAccess = (pages) => [
  ...new Set((pages || []).map(sectionForPage).filter(Boolean)),
];

// Users saved before page-level access was introduced continue to receive all
// pages in each section they were already assigned. Editing one of those users
// saves an explicit pageAccess list and opts the account into the new model.
export const canAccessPage = (user, page) => {
  if (!user) return false;
  if (user.role === "ELT") return true;
  if (user.pageAccessConfigured) return (user.pageAccess || []).includes(page);

  if (page === "dashboard") return true;
  if (page === "settings.general") {
    return (user.sections || []).some((section) => ["master_run_cuts", "deployment"].includes(section));
  }
  const section = sectionForPage(page);
  return Boolean(section && (user.sections || []).includes(section));
};

const storedPageAccessLevel = (user, page) => {
  const levels = user?.pageAccessLevels;
  if (levels instanceof Map) return levels.get(page);
  if (Array.isArray(levels)) {
    return levels.find((entry) => entry?.page === page)?.level;
  }
  return levels?.[page];
};

// Page-level access existed before read/write levels. Missing levels on an
// already-authorized account therefore mean write access, preserving every
// existing user's capabilities until an ELT administrator changes them.
export const pageAccessLevel = (user, page) => {
  if (!canAccessPage(user, page)) return null;
  if (user.role === "ELT" || !user.pageAccessConfigured) return "write";
  return storedPageAccessLevel(user, page) === "read" ? "read" : "write";
};

export const canWritePage = (user, page) => pageAccessLevel(user, page) === "write";

export const canAccessAnyPage = (user, pages) => (pages || []).some((page) => canAccessPage(user, page));

export const canAccessPageSection = (user, section) => {
  if (user?.role === "ELT") return true;
  if (!user?.pageAccessConfigured) return (user?.sections || []).includes(section);
  return (user.pageAccess || []).some((page) => sectionForPage(page) === section);
};
