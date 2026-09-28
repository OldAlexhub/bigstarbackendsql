import crypto from "node:crypto";
import LoginRateLimitCounter from "../models/LoginRateLimitCounter.js";

const keyId = (key) => crypto.createHash("sha256").update(key).digest("hex");

export class SqlRateLimitStore {
  constructor({ model = LoginRateLimitCounter } = {}) {
    this.model = model;
    this.windowMs = 0;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key, retryOnDuplicate = true) {
    const now = new Date();
    const nextReset = new Date(now.getTime() + this.windowMs);
    let counter;
    try {
      counter = await this.model
        .findOneAndUpdate(
          { _id: keyId(key) },
          [
            {
              $set: {
                totalHits: {
                  $cond: [
                    { $gt: ["$expiresAt", now] },
                    { $add: [{ $ifNull: ["$totalHits", 0] }, 1] },
                    1,
                  ],
                },
                expiresAt: {
                  $cond: [{ $gt: ["$expiresAt", now] }, "$expiresAt", nextReset],
                },
              },
            },
          ],
          { upsert: true, returnDocument: "after", updatePipeline: true }
        )
        .lean();
    } catch (error) {
      // Two app instances can attempt the first upsert for a key at the same
      // instant. The winner creates it; retry once so the loser increments it.
      if (retryOnDuplicate && error.code === 11000) return this.increment(key, false);
      throw error;
    }

    return { totalHits: counter.totalHits, resetTime: counter.expiresAt };
  }

  async decrement(key) {
    await this.model.updateOne(
      { _id: keyId(key), totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } }
    );
  }

  async resetKey(key) {
    await this.model.deleteOne({ _id: keyId(key) });
  }

  async resetAll() {
    await this.model.deleteMany({});
  }
}
