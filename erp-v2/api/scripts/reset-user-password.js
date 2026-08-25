"use strict";

const bcrypt = require("bcryptjs");
const { getPool } = require("../src/db");

async function main() {
  const organization = String(process.env.RESET_ORGANIZATION || "").trim().toLowerCase();
  const identifier = String(process.env.RESET_IDENTIFIER || "").trim().toLowerCase();
  const password = String(process.env.RESET_PASSWORD || "");

  if (!organization || !identifier || password.length < 8) {
    throw new Error("RESET_ORGANIZATION, RESET_IDENTIFIER and an 8+ character RESET_PASSWORD are required");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await getPool().query(
    `UPDATE users u
        SET password_hash=$1, updated_at=now()
       FROM organizations o
      WHERE u.organization_id=o.id
        AND o.slug=$2
        AND (lower(u.username)=$3 OR lower(u.email)=$3)
        AND u.active=true
      RETURNING u.username`,
    [passwordHash, organization, identifier]
  );

  if (result.rowCount !== 1) throw new Error(`Expected one active user, updated ${result.rowCount}`);
  console.log(`Password reset completed for ${result.rows[0].username}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
