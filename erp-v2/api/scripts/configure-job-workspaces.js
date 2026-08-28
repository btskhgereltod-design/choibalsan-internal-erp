"use strict";

const { getPool, closePool } = require("../src/db");

const profiles = {
  "choibalsan-pilot": {
    organizationSlug: "choibalsan-hugjil",
    source: "workspace-profile:choibalsan-pilot",
    jobs: [
      {
        name: "Захирал",
        accessLevel: "approve",
          workspaces: ["executive", "work-orders", "lighting", "camera", "reports"],
      },
      {
        name: "Ерөнхий инженер",
        accessLevel: "approve",
          workspaces: ["assets", "work-orders", "lighting", "camera", "maintenance", "safety", "reports"],
      },
      {
        name: "Ерөнхий нягтлан бодогч",
        accessLevel: "manage",
        workspaces: ["finance", "reports", "inventory", "procurement"],
      },
      {
        name: "Нярав",
        accessLevel: "manage",
        workspaces: ["inventory", "procurement", "assets"],
      },
      {
        name: "Цахилгааны инженер",
        accessLevel: "manage",
        workspaces: ["lighting", "work-orders", "assets", "maintenance"],
      },
      {
        name: "Сүлжээний инженер",
        accessLevel: "manage",
          workspaces: ["camera", "work-orders", "assets", "maintenance"],
      },
      {
        name: "Хөдөлмөрийн аюулгүй байдал эрүүл ахуйн ажилтан",
        accessLevel: "approve",
          workspaces: ["safety", "work-orders", "lighting", "camera"],
      },
      {
        name: "Хүний нөөцийн ажилтан",
        accessLevel: "manage",
        workspaces: ["hr", "attendance", "reports"],
      },
    ],
  },
};

function parseArguments(argv) {
  const profileIndex = argv.indexOf("--profile");
  const profileName = profileIndex >= 0 ? argv[profileIndex + 1] : null;
  return { profileName, dryRun: argv.includes("--dry-run") };
}

function fail(message) {
  throw new Error(message);
}

async function configureProfile(profileName, dryRun) {
  const profile = profiles[profileName];
  if (!profile) {
    fail(`Unknown profile: ${profileName || "(missing)"}. Available: ${Object.keys(profiles).join(", ")}`);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const organizationResult = await client.query(
      `SELECT id, slug, name
         FROM organizations
        WHERE slug = $1`,
      [profile.organizationSlug],
    );
    if (organizationResult.rowCount !== 1) {
      fail(`Expected exactly one organization with slug ${profile.organizationSlug}; found ${organizationResult.rowCount}.`);
    }
    const organization = organizationResult.rows[0];

    const requestedJobNames = profile.jobs.map(job => job.name);
    const jobsResult = await client.query(
      `SELECT id, name
         FROM jobs
        WHERE organization_id = $1
          AND active = true
          AND name = ANY($2::text[])
        ORDER BY name, id`,
      [organization.id, requestedJobNames],
    );

    const jobsByName = new Map();
    for (const job of jobsResult.rows) {
      const matches = jobsByName.get(job.name) || [];
      matches.push(job);
      jobsByName.set(job.name, matches);
    }

    for (const name of requestedJobNames) {
      const matches = jobsByName.get(name) || [];
      if (matches.length !== 1) {
        fail(`Expected exactly one active job named "${name}" in ${organization.slug}; found ${matches.length}.`);
      }
    }

    const desired = profile.jobs.flatMap(job => {
      const jobId = jobsByName.get(job.name)[0].id;
      return job.workspaces.map(workspaceCode => ({
        jobId,
        jobName: job.name,
        workspaceCode,
        accessLevel: job.accessLevel,
      }));
    });
    const desiredKeys = new Set(desired.map(row => `${row.jobId}:${row.workspaceCode}`));
    const jobIds = [...new Set(desired.map(row => row.jobId))];

    const existingResult = await client.query(
      `SELECT job_id, workspace_code, source
         FROM job_workspace_access
        WHERE organization_id = $1
          AND job_id = ANY($2::uuid[])`,
      [organization.id, jobIds],
    );
    const conflicts = existingResult.rows.filter(row =>
      desiredKeys.has(`${row.job_id}:${row.workspace_code}`) && row.source !== profile.source,
    );
    if (conflicts.length > 0) {
      fail(`Refusing to overwrite ${conflicts.length} mapping(s) owned by another source.`);
    }

    await client.query(
      `UPDATE job_workspace_access
          SET active = false,
              updated_at = now()
        WHERE organization_id = $1
          AND source = $2
          AND active = true`,
      [organization.id, profile.source],
    );

    for (const row of desired) {
      await client.query(
        `INSERT INTO job_workspace_access
           (organization_id, job_id, workspace_code, access_level, source, active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (organization_id, job_id, workspace_code)
         DO UPDATE SET access_level = EXCLUDED.access_level,
                       source = EXCLUDED.source,
                       active = true,
                       updated_at = now()`,
        [organization.id, row.jobId, row.workspaceCode, row.accessLevel, profile.source],
      );
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query(
        `INSERT INTO audit_logs
           (organization_id, user_id, action, entity_type, entity_id, detail, ip_address)
         VALUES ($1, NULL, $2, 'organization', $3, $4::jsonb, NULL)`,
        [
          organization.id,
          "job_workspace_access.profile_applied",
          organization.id,
          JSON.stringify({ profile: profileName, source: profile.source, mappings: desired }),
        ],
      );
      await client.query("COMMIT");
    }

    process.stdout.write(`${dryRun ? "DRY RUN" : "APPLIED"}: ${profileName} -> ${organization.name}\n`);
    for (const job of profile.jobs) {
      process.stdout.write(`- ${job.name}: ${job.workspaces.join(", ")} (${job.accessLevel})\n`);
    }
    process.stdout.write(`Total mappings: ${desired.length}\n`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const { profileName, dryRun } = parseArguments(process.argv.slice(2));
  try {
    await configureProfile(profileName, dryRun);
  } finally {
    await closePool();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
