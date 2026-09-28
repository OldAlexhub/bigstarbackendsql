import mongoose from "../db/sqlMongoose.js";

export const runInTransaction = (work) => mongoose.connection.transaction(work);
