export const planReplacement = (existingKeys, nextKeys) => {
  const existing = new Set(existingKeys);
  const next = new Set(nextKeys);
  return {
    created: [...next].filter((key) => !existing.has(key)),
    updated: [...next].filter((key) => existing.has(key)),
    removed: [...existing].filter((key) => !next.has(key)),
  };
};
