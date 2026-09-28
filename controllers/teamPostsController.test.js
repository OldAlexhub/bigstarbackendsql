import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "../db/sqlMongoose.js";
import Division from "../models/Division.js";
import TeamPost from "../models/TeamPost.js";
import { createTeamPost, getTeamPostNotifications, respondToTeamPost } from "./teamPostsController.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const eltUser = () => ({
  _id: new mongoose.Types.ObjectId(),
  role: "ELT",
  name: "Admin User",
  username: "admin",
});

test("team post model accepts 120 body characters and rejects 121", async () => {
  const base = {
    division: new mongoose.Types.ObjectId(),
    fromSection: "network_success",
    toSection: "deployment",
    purpose: "Operations update",
    title: "Route coverage",
    sentBy: new mongoose.Types.ObjectId(),
  };
  await assert.doesNotReject(new TeamPost({ ...base, body: "a".repeat(120) }).validate());
  await assert.rejects(
    new TeamPost({ ...base, body: "a".repeat(121) }).validate(),
    /maximum allowed length/i
  );
});

test("an information-only post cannot receive a response", async () => {
  const originalFindById = TeamPost.findById;
  const originalFindOneAndUpdate = TeamPost.findOneAndUpdate;
  const division = new mongoose.Types.ObjectId();
  let updateCalled = false;
  const existing = {
    _id: new mongoose.Types.ObjectId(),
    division,
    toSection: "deployment",
    responseRequested: false,
    status: "sent",
  };
  const query = {
    select() { return query; },
    then(resolve, reject) { return Promise.resolve(existing).then(resolve, reject); },
  };
  TeamPost.findById = () => query;
  TeamPost.findOneAndUpdate = () => { updateCalled = true; };
  try {
    const res = response();
    await respondToTeamPost({
      user: eltUser(),
      params: { id: String(existing._id) },
      body: { section: "deployment", responseBody: "Received." },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /did not request/i);
    assert.equal(updateCalled, false);
  } finally {
    TeamPost.findById = originalFindById;
    TeamPost.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("creating a post rejects a body over 120 characters before writing", async () => {
  const originalCreate = TeamPost.create;
  let createCalled = false;
  TeamPost.create = async () => { createCalled = true; };
  try {
    const res = response();
    await createTeamPost({
      user: eltUser(),
      body: {
        division: String(new mongoose.Types.ObjectId()),
        fromSection: "deployment",
        purpose: "Update",
        title: "Important information",
        body: "x".repeat(121),
        responseRequested: true,
      },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /120 characters/i);
    assert.equal(createCalled, false);
  } finally {
    TeamPost.create = originalCreate;
  }
});

test("read-only Posts access cannot create a team post", async () => {
  const originalCreate = TeamPost.create;
  let createCalled = false;
  TeamPost.create = async () => { createCalled = true; };
  try {
    const res = response();
    await createTeamPost({
      user: {
        _id: new mongoose.Types.ObjectId(),
        role: "Coordinator",
        pageAccessConfigured: true,
        pageAccess: ["deployment.posts"],
        pageAccessLevels: [{ page: "deployment.posts", level: "read" }],
      },
      body: {
        division: String(new mongoose.Types.ObjectId()),
        fromSection: "deployment",
        purpose: "Update",
        title: "Coverage",
        body: "Route coverage update.",
      },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /read & write/i);
    assert.equal(createCalled, false);
  } finally {
    TeamPost.create = originalCreate;
  }
});

test("a Deployment post is routed to Network Success with its audit snapshot", async () => {
  const originalExists = Division.exists;
  const originalCreate = TeamPost.create;
  const originalFindById = TeamPost.findById;
  const division = new mongoose.Types.ObjectId();
  const user = eltUser();
  const postId = new mongoose.Types.ObjectId();
  let saved;
  Division.exists = async () => ({ _id: division });
  TeamPost.create = async (value) => {
    saved = value;
    return { _id: postId };
  };
  const post = {
    _id: postId,
    division,
    fromSection: "deployment",
    toSection: "network_success",
    purpose: "Coverage",
    title: "Route coverage",
    body: "Route 101 is covered.",
    responseRequested: true,
    status: "sent",
    sentBy: user._id,
    sentByName: user.name,
    sentByUsername: user.username,
    receivedSeenBy: [],
    responseSeenBy: [],
    toObject() { return { ...this }; },
  };
  const query = {
    populate() { return query; },
    then(resolve, reject) { return Promise.resolve(post).then(resolve, reject); },
  };
  TeamPost.findById = () => query;

  try {
    const res = response();
    await createTeamPost({
      user,
      body: {
        division: String(division),
        fromSection: "deployment",
        purpose: " Coverage ",
        title: " Route coverage ",
        body: " Route 101 is covered. ",
        responseRequested: true,
      },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(saved.toSection, "network_success");
    assert.equal(saved.sentByName, "Admin User");
    assert.equal(saved.body, "Route 101 is covered.");
    assert.equal(saved.responseRequested, true);
    assert.equal(res.body.post.direction, "sent");
  } finally {
    Division.exists = originalExists;
    TeamPost.create = originalCreate;
    TeamPost.findById = originalFindById;
  }
});

test("notification totals include unseen incoming posts and unseen replies by division", async () => {
  const originalDivisionFind = Division.find;
  const originalTeamPostFind = TeamPost.find;
  const division = new mongoose.Types.ObjectId();
  let filter;
  Division.find = () => ({ distinct: async () => [division] });
  TeamPost.find = (value) => {
    filter = value;
    const query = {
      select() { return query; },
      lean() { return Promise.resolve([{ division }, { division }]); },
    };
    return query;
  };
  try {
    const res = response();
    await getTeamPostNotifications({ user: eltUser(), query: { section: "network_success" } }, res);
    assert.equal(res.body.count, 2);
    assert.equal(res.body.byDivision[String(division)], 2);
    assert.equal(filter.$or[0].toSection, "network_success");
    assert.equal(filter.$or[1].fromSection, "network_success");
    assert.equal(filter.$or[1].status, "responded");
  } finally {
    Division.find = originalDivisionFind;
    TeamPost.find = originalTeamPostFind;
  }
});

test("responding rejects a response over 120 characters before lookup", async () => {
  const originalFindById = TeamPost.findById;
  let lookupCalled = false;
  TeamPost.findById = () => { lookupCalled = true; };
  try {
    const res = response();
    await respondToTeamPost({
      user: eltUser(),
      params: { id: String(new mongoose.Types.ObjectId()) },
      body: { section: "network_success", responseBody: "x".repeat(121) },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /120 characters/i);
    assert.equal(lookupCalled, false);
  } finally {
    TeamPost.findById = originalFindById;
  }
});
