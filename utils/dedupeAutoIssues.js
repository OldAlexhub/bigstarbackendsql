export const ISSUE_IDENTITY_INDEX_NAME = "uniq_issue_identity";

export const ISSUE_IDENTITY_INDEX_KEY = {
  division: 1,
  date: 1,
  route: 1,
  operator: 1,
  disruptionType: 1,
};

const sameKey = (left = {}, right = {}) => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => {
      const [rightKey, rightValue] = rightEntries[index] || [];
      return key === rightKey && value === rightValue;
    })
  );
};

const isDesiredIndex = (index) =>
  index.name === ISSUE_IDENTITY_INDEX_NAME &&
  index.unique === true &&
  sameKey(index.key, ISSUE_IDENTITY_INDEX_KEY);

const isObsoleteIdentityIndex = (index) =>
  sameKey(index.key, { runCutDay: 1, autoSyncTag: 1 }) ||
  sameKey(index.key, ISSUE_IDENTITY_INDEX_KEY) ||
  index.name === ISSUE_IDENTITY_INDEX_NAME;

// Normalizes issue dates, keeps one row per visible business identity, and
// installs the database constraint that prevents the duplicates returning.
// Manual records always win; otherwise the newest generated row is kept.
export const migrateIssueIdentity = async (collection) => {
  const normalizeResult = await collection.updateMany(
    { date: { $type: "date" } },
    [
      {
        $set: {
          date: {
            $dateFromParts: {
              year: { $year: "$date" },
              month: { $month: "$date" },
              day: { $dayOfMonth: "$date" },
            },
          },
        },
      },
    ]
  );

  const duplicateGroups = await collection
    .aggregate([
      {
        $set: {
          __manualPriority: {
            $cond: [{ $eq: [{ $ifNull: ["$autoSyncTag", null] }, null] }, 1, 0],
          },
        },
      },
      { $sort: { __manualPriority: -1, createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: {
            division: "$division",
            date: "$date",
            route: { $ifNull: ["$route", null] },
            operator: { $ifNull: ["$operator", null] },
            disruptionType: "$disruptionType",
          },
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  const duplicateIds = duplicateGroups.flatMap((group) => group.ids.slice(1));
  const deleteResult = duplicateIds.length
    ? await collection.deleteMany({ _id: { $in: duplicateIds } })
    : { deletedCount: 0 };

  const indexes = await collection.indexes();
  const desiredIndex = indexes.find(isDesiredIndex);
  const obsoleteIndexes = indexes.filter(
    (index) =>
      index.name !== "_id_" &&
      index !== desiredIndex &&
      isObsoleteIdentityIndex(index)
  );

  for (const index of obsoleteIndexes) {
    await collection.dropIndex(index.name);
  }

  if (!desiredIndex) {
    await collection.createIndex(ISSUE_IDENTITY_INDEX_KEY, {
      name: ISSUE_IDENTITY_INDEX_NAME,
      unique: true,
    });
  }

  return {
    normalizedDates: normalizeResult.modifiedCount,
    duplicateGroups: duplicateGroups.length,
    deletedRecords: deleteResult.deletedCount,
    droppedIndexes: obsoleteIndexes.map((index) => index.name),
    createdIndex: !desiredIndex,
  };
};
