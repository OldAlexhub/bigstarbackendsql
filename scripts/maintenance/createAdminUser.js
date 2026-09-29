import dotenv from "dotenv";
import mongoose from "../../db/sqlMongoose.js";
import connectTodb from "../../db/connectTodb.js";
import User, { SECTIONS } from "../../models/User.js";

dotenv.config({ quiet: true });

const run = async () => {
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim();
  const role = process.env.ADMIN_ROLE?.trim() || "Super Admin";

  const missing = [
    ["ADMIN_USERNAME", username],
    ["ADMIN_PASSWORD", password],
    ["ADMIN_NAME", name],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing required admin variables: ${missing.join(", ")}`);
  }

  await connectTodb();

  const existing = await User.findOne({ username });

  if (existing) {
    existing.password = password;
    existing.name = name;
    existing.role = role;
    existing.sections = SECTIONS;
    await existing.save();
    console.log(`Updated existing user "${username}"`);
  } else {
    await User.create({
      username,
      password,
      name,
      role,
      sections: SECTIONS,
    });
    console.log(`Created user "${username}"`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(() => {
  console.error("Seed failed.");
  process.exit(1);
});
