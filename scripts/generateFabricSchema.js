import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildModelMapping, mappingsDdl } from "../db/relationalMapping.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const modelsDirectory = path.join(projectDirectory, "models");
const schemaName = process.argv[2] || "dbo";

const modelFiles = fs
  .readdirSync(modelsDirectory)
  .filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"))
  .sort();

const mappings = [];
for (const file of modelFiles) {
  const module = await import(pathToFileURL(path.join(modelsDirectory, file)));
  const Model = module.default;
  if (Model?.schema && Model?.collectionName) mappings.push(buildModelMapping(Model));
}

process.stdout.write(mappingsDdl(mappings, schemaName));
