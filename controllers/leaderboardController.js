import PDFDocument from "pdfkit";
import Division from "../models/Division.js";
import RunCutDay from "../models/RunCutDay.js";
import DailyIssueLog from "../models/DailyIssueLog.js";
import { emptyMetrics, accumulate, coveragePct, runCutFulfillmentPct } from "../utils/weeklyMetrics.js";
import { pdfPageLeft, drawPdfTable } from "../utils/pdfTable.js";
import { filterLeaderboardRowsForUser, rankLeaderboardRows } from "../utils/leaderboard.js";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const roundFrac = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000);
const fmtPct = (v) => (v == null ? "" : `${Math.round(v * 1000) / 10}%`);

// Rank every active division before applying the requesting user's division
// visibility. That keeps an authorized division's true company position.
// The same two metrics (run cut / revenue hour fulfillment) ELT Reporting shows
// per division, computed the same way from RunCutDay via weeklyMetrics.js.
// Ranking key is the average of the two: a division that deploys every duty
// but under-covers revenue hours (or vice versa) shouldn't outrank one that
// does both well. Issues logged is shown as a column, not folded into the
// score, since more logged issues reflects tracking activity rather than
// necessarily worse performance.
const computeLeaderboard = async (req, from, to) => {
  const divisions = await Division.find({ active: true }).sort({ code: 1 });

  const ranked = await Promise.all(
    divisions.map(async (division) => {
      const [runCutDays, issueCount] = await Promise.all([
        RunCutDay.find({ division: division._id, date: { $gte: from, $lte: to } }).populate("route", "type"),
        DailyIssueLog.countDocuments({ division: division._id, date: { $gte: from, $lte: to } }),
      ]);

      const metrics = emptyMetrics();
      runCutDays.forEach((rcd) => {
        if (rcd.route?.type === "standby") return;
        accumulate(metrics, rcd);
      });

      const runCutPct = metrics.dutiesScheduled ? roundFrac(runCutFulfillmentPct(metrics)) : null;
      const revHourPct = metrics.revenueHoursScheduled ? roundFrac(coveragePct(metrics)) : null;
      const avgFulfillmentPct =
        runCutPct != null && revHourPct != null ? roundFrac((runCutPct + revHourPct) / 2) : runCutPct ?? revHourPct;

      return {
        divisionId: division._id,
        code: division.code,
        name: division.name,
        runCutFulfillmentPct: runCutPct,
        revenueHourFulfillmentPct: revHourPct,
        avgFulfillmentPct,
        revenueHoursAtRisk: round2(metrics.revenueHoursScheduled - metrics.revenueHoursCovered),
        issueCount,
      };
    })
  );

  const companyRanked = rankLeaderboardRows(ranked);
  const visibleDivisions = filterLeaderboardRowsForUser(companyRanked, req.user);
  return {
    divisions: visibleDivisions,
    totalDivisions: companyRanked.length,
    isCompanyWide: visibleDivisions.length === companyRanked.length,
  };
};

const resolveRange = (query) => {
  const { from, to } = query;
  if (!from || !to) return { error: "from and to are required" };
  return { from: new Date(from), to: new Date(to) };
};

export const getLeaderboard = async (req, res) => {
  const { error, from, to } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const leaderboard = await computeLeaderboard(req, from, to);
  res.json({ from: iso(from), to: iso(to), ...leaderboard });
};

export const exportLeaderboardPdf = async (req, res) => {
  const { error, from, to } = resolveRange(req.query);
  if (error) return res.status(400).json({ message: error });

  const { divisions, totalDivisions, isCompanyWide } = await computeLeaderboard(req, from, to);
  const filenameBase = `Leaderboard-${iso(from)}-to-${iso(to)}`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  const doc = new PDFDocument({ margin: 40, size: "letter" });
  doc.pipe(res);

  doc.fontSize(18).text("Division Leaderboard", { align: "left" });
  doc.fontSize(11).fillColor("#666").text(`Company-wide rank by fulfillment — ${iso(from)} to ${iso(to)}`);
  if (!isCompanyWide) {
    doc.fontSize(9).text(`Showing authorized divisions; ranks are among ${totalDivisions} active divisions.`);
  }
  doc.moveDown();

  const pageLeft = pdfPageLeft(doc);
  const headers = ["Rank", "Division", "Run Cut Fulfill.", "Rev. Hr Fulfill.", "Avg Fulfill.", "Issues Logged", "Hrs At Risk"];
  const tableRows = divisions.map((d) => [
    d.rank,
    d.name,
    fmtPct(d.runCutFulfillmentPct),
    fmtPct(d.revenueHourFulfillmentPct),
    fmtPct(d.avgFulfillmentPct),
    d.issueCount,
    d.revenueHoursAtRisk,
  ]);
  drawPdfTable(doc, pageLeft, "Divisions", headers, tableRows, [35, 160, 80, 80, 70, 70, 55]);

  doc.end();
};
