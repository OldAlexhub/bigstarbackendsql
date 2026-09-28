export const normalizeRouteCode = (value) =>
  String(value ?? "")
    .toUpperCase()
    .trim()
    .replace(/^BST/, "")
    // Source systems report the revenue shift number without BigStar's
    // roster-only standby marker (for example 3021 vs 3021(STBY)). Treat a
    // terminal, delimited STBY/STANDBY label as metadata, not route identity.
    // Codes such as STBY-1 are unaffected because the marker is not terminal.
    .replace(/[\s([_-]+(?:STBY|STANDBY)[\s)\]_-]*$/i, "")
    .replace(/[^A-Z0-9]/g, "");

const letterDeletionDistance = (a, b) => {
  let shorter = a;
  let longer = b;
  if (a.length > b.length) [shorter, longer] = [b, a];
  let i = 0;
  let j = 0;
  let deleted = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (/[A-Z]/.test(longer[j])) {
      deleted += 1;
      j += 1;
    } else {
      return null;
    }
  }
  while (j < longer.length) {
    if (!/[A-Z]/.test(longer[j])) return null;
    deleted += 1;
    j += 1;
  }
  return i === shorter.length ? deleted : null;
};

const levenshtein = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const before = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = before;
    }
  }
  return row[b.length];
};

const publicRoute = (route) => ({ id: String(route._id || route.id), code: route.code, type: route.type });

export const resolveRoute = (sourceCode, routes, aliases = []) => {
  const normalized = normalizeRouteCode(sourceCode);
  const exact = routes.filter((route) => normalizeRouteCode(route.code) === normalized);
  if (exact.length === 1) return { route: exact[0], method: "normalized_exact", suggestions: [] };
  if (exact.length > 1) return { route: null, method: "ambiguous", suggestions: exact.map(publicRoute) };

  const alias = aliases.find((item) => item.normalizedSourceRoute === normalized);
  if (alias) {
    const aliased = routes.find((route) => String(route._id || route.id) === String(alias.route?._id || alias.route));
    if (aliased) return { route: aliased, method: "confirmed_alias", suggestions: [] };
  }

  const sourceDigits = normalized.replace(/\D/g, "");
  const safe = routes.filter((route) => {
    const candidate = normalizeRouteCode(route.code);
    if (candidate.replace(/\D/g, "") !== sourceDigits) return false;
    const distance = letterDeletionDistance(normalized, candidate);
    return distance !== null && distance >= 1 && distance <= 2;
  });
  if (safe.length === 1) return { route: safe[0], method: "safe_letter_difference", suggestions: [] };
  if (safe.length > 1) return { route: null, method: "ambiguous", suggestions: safe.map(publicRoute) };

  const suggestions = routes
    .map((route) => ({ route, distance: levenshtein(normalized, normalizeRouteCode(route.code)) }))
    .filter(({ distance }) => distance <= Math.max(2, Math.floor(normalized.length / 3)))
    .sort((a, b) => a.distance - b.distance || a.route.code.localeCompare(b.route.code))
    .slice(0, 3)
    .map(({ route }) => publicRoute(route));
  return { route: null, method: suggestions.length ? "suggestion_only" : "unmatched", suggestions };
};

export const divisionMatchScores = (rows, divisions, routes, costCenter = null) => {
  const uniqueCodes = [...new Set(rows.map((row) => row.sourceRoute))];
  return divisions
    .map((division) => {
      const divisionRoutes = routes.filter((route) => String(route.division) === String(division._id));
      let matchedRoutes = 0;
      for (const code of uniqueCodes) if (resolveRoute(code, divisionRoutes).route) matchedRoutes += 1;
      const costCenterText = String(costCenter || "").toUpperCase();
      const costCenterBonus =
        costCenterText && `${division.code} ${division.name}`.toUpperCase().includes(costCenterText) ? 0.2 : 0;
      const overlap = uniqueCodes.length ? matchedRoutes / uniqueCodes.length : 0;
      return {
        division: String(division._id),
        code: division.code,
        name: division.name,
        matchedRoutes,
        totalRoutes: uniqueCodes.length,
        score: Math.min(1, overlap + costCenterBonus),
        costCenterMatch: Boolean(costCenterBonus),
      };
    })
    .sort((a, b) => b.score - a.score || b.matchedRoutes - a.matchedRoutes || a.code.localeCompare(b.code));
};
