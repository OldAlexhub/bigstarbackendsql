export const assertTransactionSupport = async (connection) => {
  const result = await connection.query("SELECT CAST(1 AS int) AS warehouse_ready");
  if (Number(result.rows[0]?.warehouse_ready) !== 1) {
    throw new Error("Microsoft Fabric Warehouse connectivity check failed.");
  }
  await connection.transaction(() => connection.query("SELECT CAST(1 AS int) AS transaction_ready"));
};
