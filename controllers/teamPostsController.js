import mongoose from "../db/sqlMongoose.js";
import Division from "../models/Division.js";
import TeamPost, { POST_SECTIONS } from "../models/TeamPost.js";
import { canAccessDivision, canAccessPage, canWritePage, divisionFilter } from "../middleware/access.js";

const clean = (value) => String(value || "").trim();
const otherSection = (section) => section === "network_success" ? "deployment" : "network_success";

const postPage = (section) => `${section}.posts`;
const validateSection = (user, section) =>
  POST_SECTIONS.includes(section) && canAccessPage(user, postPage(section));
const validateWriteSection = (user, section) =>
  POST_SECTIONS.includes(section) && canWritePage(user, postPage(section));

const populatePost = (query) =>
  query
    .populate("division", "code name")
    .populate("sentBy", "name username")
    .populate("respondedBy", "name username");

const postForUser = (post, user, section) => {
  const value = post.toObject ? post.toObject() : post;
  const receivedSeenBy = value.receivedSeenBy || [];
  const responseSeenBy = value.responseSeenBy || [];
  delete value.receivedSeenBy;
  delete value.responseSeenBy;
  return {
    ...value,
    direction: value.toSection === section ? "received" : "sent",
    unread:
      (value.toSection === section && !receivedSeenBy.some((id) => String(id) === String(user._id))) ||
      (value.fromSection === section && value.status === "responded" && !responseSeenBy.some((id) => String(id) === String(user._id))),
  };
};

const countsByDivision = (posts) => posts.reduce((counts, post) => {
  const key = String(post.division);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

export const listTeamPosts = async (req, res) => {
  const { division, section } = req.query;
  if (!mongoose.isValidObjectId(division)) return res.status(400).json({ message: "Choose a division." });
  if (!validateSection(req.user, section)) return res.status(403).json({ message: "Access to this post section is required." });
  if (!canAccessDivision(req.user, division)) return res.status(403).json({ message: "No access to this division" });

  const posts = await populatePost(
    TeamPost.find({ division, $or: [{ fromSection: section }, { toSection: section }] })
      .sort({ createdAt: -1 })
      .limit(250)
  );
  res.json({ posts: posts.map((post) => postForUser(post, req.user, section)) });
};

export const createTeamPost = async (req, res) => {
  const { division, fromSection } = req.body;
  if (!mongoose.isValidObjectId(division)) return res.status(400).json({ message: "Choose a division." });
  if (!validateWriteSection(req.user, fromSection)) return res.status(403).json({ message: "Read & write access to the sending section is required." });
  if (!canAccessDivision(req.user, division)) return res.status(403).json({ message: "No access to this division" });

  const purpose = clean(req.body.purpose);
  const title = clean(req.body.title);
  const body = clean(req.body.body);
  if (!purpose || !title || !body) return res.status(400).json({ message: "Purpose, title, and body are required." });
  if (purpose.length > 80 || title.length > 100) {
    return res.status(400).json({ message: "Purpose or title is too long." });
  }
  if (body.length > 120) return res.status(400).json({ message: "Post body cannot exceed 120 characters." });
  if (!(await Division.exists({ _id: division }))) return res.status(404).json({ message: "Division not found." });

  const created = await TeamPost.create({
    division,
    fromSection,
    toSection: otherSection(fromSection),
    purpose,
    title,
    body,
    responseRequested: req.body.responseRequested === true,
    sentBy: req.user._id,
    sentByName: req.user.name || "",
    sentByUsername: req.user.username || "",
  });
  const post = await populatePost(TeamPost.findById(created._id));
  res.status(201).json({ post: postForUser(post, req.user, fromSection) });
};

export const respondToTeamPost = async (req, res) => {
  const { section } = req.body;
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid post." });
  if (!validateWriteSection(req.user, section)) return res.status(403).json({ message: "Read & write access to the responding section is required." });
  const responseBody = clean(req.body.responseBody);
  if (!responseBody) return res.status(400).json({ message: "Enter a response." });
  if (responseBody.length > 120) return res.status(400).json({ message: "Response cannot exceed 120 characters." });

  const existing = await TeamPost.findById(req.params.id).select("division toSection responseRequested status");
  if (!existing) return res.status(404).json({ message: "Post not found." });
  if (!canAccessDivision(req.user, existing.division)) return res.status(403).json({ message: "No access to this division" });
  if (existing.toSection !== section) return res.status(403).json({ message: "Only the receiving team can respond to this post." });
  if (!existing.responseRequested) return res.status(409).json({ message: "This post did not request a response." });

  const updated = await TeamPost.findOneAndUpdate(
    { _id: existing._id, status: "sent" },
    {
      $set: {
        status: "responded",
        responseBody,
        respondedBy: req.user._id,
        respondedByName: req.user.name || "",
        respondedByUsername: req.user.username || "",
        respondedAt: new Date(),
        responseSeenBy: [],
      },
    },
    { returnDocument: "after", runValidators: true }
  );
  if (!updated) return res.status(409).json({ message: "This post has already received a response." });
  const post = await populatePost(TeamPost.findById(updated._id));
  res.json({ post: postForUser(post, req.user, section), message: "Response sent." });
};

export const getTeamPostNotifications = async (req, res) => {
  const { section } = req.query;
  if (!validateSection(req.user, section)) return res.status(403).json({ message: "Access to this post section is required." });
  const divisionIds = await Division.find({
    ...divisionFilter(req.user),
    active: { $ne: false },
  }).distinct("_id");
  const posts = await TeamPost.find({
    division: { $in: divisionIds },
    $or: [
      { toSection: section, receivedSeenBy: { $ne: req.user._id } },
      { fromSection: section, status: "responded", responseSeenBy: { $ne: req.user._id } },
    ],
  }).select("division").lean();
  res.json({ count: posts.length, byDivision: countsByDivision(posts) });
};

export const acknowledgeTeamPostNotifications = async (req, res) => {
  const { division, section } = req.body;
  if (!mongoose.isValidObjectId(division)) return res.status(400).json({ message: "Choose a division." });
  if (!validateSection(req.user, section)) return res.status(403).json({ message: "Access to this post section is required." });
  if (!canAccessDivision(req.user, division)) return res.status(403).json({ message: "No access to this division" });

  const [received, responses] = await Promise.all([
    TeamPost.updateMany(
      { division, toSection: section, receivedSeenBy: { $ne: req.user._id } },
      { $addToSet: { receivedSeenBy: req.user._id } }
    ),
    TeamPost.updateMany(
      { division, fromSection: section, status: "responded", responseSeenBy: { $ne: req.user._id } },
      { $addToSet: { responseSeenBy: req.user._id } }
    ),
  ]);
  res.json({ acknowledged: (received.modifiedCount || 0) + (responses.modifiedCount || 0) });
};
