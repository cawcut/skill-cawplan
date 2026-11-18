# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub:

1. Open <https://github.com/cawcut/skill-cawplan/security/advisories/new>
   (repository **Security** tab → **Report a vulnerability**).
2. Describe the issue, the affected component (a skill, the `cawplan` CLI, or the
   CawPlan MCP server) and version, and the steps to reproduce it.

Do not open a public issue, pull request or discussion for a vulnerability, and
do not include real credentials or other people's data in the report.

We acknowledge reports in the advisory and keep you updated there until the
issue is fixed or closed.

## Scope

- The `cawplan` CLI (`cli/`, published to npm as `cawplan`).
- The agent skills in `skills/` and the plugin manifests.
- The CawPlan MCP server at
  `https://api.cawplan.com/core-product/api/v1/public/openapi/mcp`, including
  its OAuth sign-in.

## Supported versions

Fixes are released in the latest CLI version on npm and the latest skill
release. Update with `npm install -g cawplan@latest` and
`cawplan skill update` (or `npx skills update`).
