import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCredentialPayload } from "../credential-payload.mjs";
test("permits the pinned SDK's compiled environment-schema getters without dropping credential assertions", () => {
  assert.equal(
    hasCredentialPayload(
      "schemaExports({GITHUB_TOKEN:()=>Jae,HOME:()=>home}); var Jae=u.str();",
    ),
    false,
  );
  for (const value of [
    'GITHUB_TOKEN = "synthetic"',
    'GITHUB_TOKEN: "synthetic"',
    "OPENAI_API_KEY=synthetic",
    "TYPESAFE_API_KEY: synthetic",
    "PRMONITOR_SESSION_SECRET = synthetic",
    "GITHUB_TOKEN=()=>value",
    "GITHUB_TOKEN:()=>loadCredential()",
    'GITHUB_TOKEN:()=>"synthetic"',
    "GITHUB_TOKEN:()=>schema.member",
    'GITHUB_TOKEN:()=>schema["member"]',
    "GITHUB_TOKEN:()=>schema+suffix",
    "GITHUB_TOKEN:()=>{return schema}",
    '{"GITHUB_TOKEN":"synthetic"}',
    'GITHUB_TOKEN:()=>schema, OPENAI_API_KEY: "synthetic"',
  ])
    assert.equal(hasCredentialPayload(value), true, value);
});
test("detects recognizable credential literals even under unrelated property names", () => {
  for (const value of [
    "ghp_" + "A".repeat(40),
    "ghp_" + "A".repeat(300),
    "github_pat_" + "B".repeat(60),
    "sk-" + "C".repeat(40),
    "sk-ant-" + "D".repeat(40),
  ])
    assert.equal(
      hasCredentialPayload("const unrelated = " + JSON.stringify(value)),
      true,
    );
  assert.equal(
    hasCredentialPayload(
      "const Jae=" +
        JSON.stringify("ghp_" + "A".repeat(40)) +
        ";GITHUB_TOKEN:()=>Jae,",
    ),
    true,
  );
  assert.equal(
    hasCredentialPayload('const example="YOUR_GITHUB_TOKEN";'),
    false,
  );
});
