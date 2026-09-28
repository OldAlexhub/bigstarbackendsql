import { existsSync } from "node:fs";
import path from "node:path";

export const requiredFile = ({ envName, description = "input file" }) => {
  const fileFlagIndex = process.argv.indexOf("--file");
  const fromFlag = fileFlagIndex >= 0 ? process.argv[fileFlagIndex + 1] : "";
  const configuredPath = fromFlag || process.env[envName];

  if (!configuredPath) {
    throw new Error(`Provide the ${description} with --file <path> or ${envName}.`);
  }

  const resolvedPath = path.resolve(configuredPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`${description} not found: ${resolvedPath}`);
  }

  return resolvedPath;
};
