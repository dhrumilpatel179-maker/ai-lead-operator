import { appendFile } from "node:fs/promises";
import { validateStagingChangeApproval } from "./supabase-staging-core.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required staging approval value: ${name}`);
  return value;
}

const approval = validateStagingChangeApproval({
  mode: required("SUPABASE_STAGING_APPROVAL_MODE"),
  statement: required("SUPABASE_STAGING_CHANGE_APPROVAL"),
  actualCommit: required("GITHUB_SHA"),
  reviewedCommit: required("REVIEWED_COMMIT"),
  approvedCommit: required("SUPABASE_STAGING_APPROVED_COMMIT"),
  approvedBy: required("SUPABASE_STAGING_APPROVED_BY"),
  approvedAt: required("SUPABASE_STAGING_APPROVED_AT"),
});

const model = approval.independentReviewerClaimed
  ? "required-reviewer (GitHub configuration must enforce the reviewer)"
  : "owner-attestation (no independent reviewer gate)";
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## Staging change approval",
    "",
    `- Approval model: ${model}`,
    `- Exact reviewed commit: \`${process.env.GITHUB_SHA}\``,
    `- Recorded by: \`${process.env.SUPABASE_STAGING_APPROVED_BY}\``,
    `- Recorded at: \`${process.env.SUPABASE_STAGING_APPROVED_AT}\``,
    "",
  ].join("\n"));
}
console.log(`Exact-commit and staging approval checks passed using ${model}.`);
