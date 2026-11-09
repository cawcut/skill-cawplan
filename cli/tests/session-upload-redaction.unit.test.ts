import {describe, expect, test} from "vitest";
import {redactSecrets, redactSecretsDeep} from "../src/lib/collect/redact";
import {buildDailyReportUploadBody} from "../src/lib/ai-session/reports-api";
import type {DailyApiJson} from "../src/lib/collect/types";

// Fixtures are assembled at runtime so no token-shaped literal lives in the repo.
const fake = (...parts: string[]) => parts.join("");
const AWS_KEY = fake("AKIA", "ABCDEFGHIJKLMNOP");
const GHP = fake("ghp", "_", "a".repeat(36));
const GHO = fake("gho", "_", "B1".repeat(18));
const GITHUB_PAT = fake("github", "_pat_", "11ABCDEFG0", "x".repeat(40));
const OPENAI = fake("sk", "-proj-", "Q".repeat(40));
const ANTHROPIC = fake("sk", "-ant-api03-", "z".repeat(60));
const SLACK = fake("xox", "b-", "123456789012-", "abcdefABCDEF");
const CAWPLAN_KEY = fake("cwpu", "_api_", "01234567", "89abcdef");
const JWT = fake("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJ", "zdWIiOiJ1c2VyIn0", ".", "c2lnbmF0dXJlLXZhbHVl");
const PEM = fake(
    "-----BEGIN RSA ", "PRIVATE KEY-----\n",
    "MIIEowIBAAKCAQEAx\nabcdefghijklmnop\n",
    "-----END RSA ", "PRIVATE KEY-----",
);

describe("redactSecrets", () => {
    test.each([
        ["AWS access key", `aws key ${AWS_KEY} here`, AWS_KEY, "[REDACTED:aws-access-key]"],
        ["GitHub ghp_ token", `token ${GHP}`, GHP, "[REDACTED:github-token]"],
        ["GitHub gho_ token", `oauth ${GHO}`, GHO, "[REDACTED:github-token]"],
        ["GitHub fine-grained PAT", `pat ${GITHUB_PAT}`, GITHUB_PAT, "[REDACTED:github-token]"],
        ["OpenAI sk- key", `OPENAI ${OPENAI}`, OPENAI, "[REDACTED:api-key]"],
        ["Anthropic sk-ant- key", `use ${ANTHROPIC}`, ANTHROPIC, "[REDACTED:api-key]"],
        ["Slack token", `slack ${SLACK}`, SLACK, "[REDACTED:slack-token]"],
        ["CawPlan API key", `key ${CAWPLAN_KEY}`, CAWPLAN_KEY, "[REDACTED:cawplan-api-key]"],
        ["JWT", `jwt ${JWT} end`, JWT, "[REDACTED:jwt]"],
        ["PEM private key", `key:\n${PEM}\nafter`, "MIIEowIBAAKCAQEAx", "[REDACTED:private-key]"],
    ])("masks %s", (_name, input, secret, marker) => {
        const {text, count} = redactSecrets(input);
        expect(text).not.toContain(secret);
        expect(text).toContain(marker);
        expect(count).toBeGreaterThan(0);
    });

    test("masks a truncated PEM block through the end of the text", () => {
        const {text} = redactSecrets(fake("-----BEGIN ", "PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0B"));
        expect(text).toBe("[REDACTED:private-key]");
    });

    test("masks Authorization: Bearer values", () => {
        const {text} = redactSecrets(fake("curl -H 'Authorization: Bearer ", "abc123def456", "ghi789jkl' https://x"));
        expect(text).toBe("curl -H 'Authorization: Bearer [REDACTED]' https://x");
    });

    test.each([
        ["password=hunter22", "password=[REDACTED]"],
        ["DB_PASSWORD: s3cr3t!x", "DB_PASSWORD: [REDACTED]"],
        ["client_secret=abcd1234&next=1", "client_secret=[REDACTED]&next=1"],
        [fake("GITHUB_TOKEN=", "abcdef", "123456"), "GITHUB_TOKEN=[REDACTED]"],
        ['{"api_key": "abcd-efgh-ijkl"}', '{"api_key": "[REDACTED]"}'],
        [fake("aws_secret_access_key = ", "wJalrXUtnF", "EMIK7MDENG"), "aws_secret_access_key = [REDACTED]"],
    ])("masks key/value pair %s", (input, expected) => {
        expect(redactSecrets(input).text).toBe(expected);
    });

    test.each([
        "max_tokens: 4096 and input_tokens=1200",
        "token=${GITHUB_TOKEN}",
        "password: <your-password>",
        "Fix the token refresh bug in http.ts",
        "/Users/dev/project/src/lib/token-store.ts",
        "use sk-learn for this",
    ])("keeps ordinary text: %s", (input) => {
        expect(redactSecrets(input)).toEqual({text: input, count: 0});
    });

    const STRIPE_LIVE = fake("sk", "_live_", "4eC39HqLyjWDarjtT1zdp7dc");
    const STRIPE_TEST = fake("sk", "_test_", "51H8abcdefGHIJKLmnop");
    const STRIPE_RESTRICTED = fake("rk", "_live_", "9ZyXwVuTsRqPoNmLkJ");
    const GITLAB = fake("glpat", "-", "xxxxxxxxxxxxxxxxxxxx");
    const NPM = fake("npm", "_", "A1b2C3d4E5".repeat(3), "f6G7h8");
    const GOOGLE = fake("AIza", "SyD-", "0123456789abcdefABCDEFGHIJ_-xyz");

    test.each([
        ["URL userinfo (postgres)", "postgres://admin:S3cret@db.internal:5432/app", "postgres://admin:[REDACTED]@db.internal:5432/app"],
        ["URL userinfo (empty user)", "redis://:hunter22@cache:6379/0", "redis://:[REDACTED]@cache:6379/0"],
        ["URL userinfo (https)", "git clone https://bot:p%40ssw0rd@git.example.com/x.git", "git clone https://bot:[REDACTED]@git.example.com/x.git"],
        ["Authorization: Basic", "Authorization: Basic dXNlcjpwYXNzd29yZA==", "Authorization: Basic [REDACTED]"],
        ["JSON Authorization header", '{"Authorization": "token abcdef0123456789"}', '{"Authorization": "token [REDACTED]"}'],
        ["Cookie header", `curl -H "Cookie: session=abc123; csrftoken=xyz789" https://x`, `curl -H "Cookie: [REDACTED]" https://x`],
        ["Set-Cookie header", "Set-Cookie: sid=deadbeef42; Path=/; HttpOnly", "Set-Cookie: [REDACTED]"],
        ["STRIPE_KEY= assignment", `STRIPE_KEY=${STRIPE_LIVE}`, "STRIPE_KEY=[REDACTED:stripe-key]"],
        ["bare Stripe test key", `use ${STRIPE_TEST} locally`, "use [REDACTED:stripe-key] locally"],
        ["bare Stripe restricted key", `rk ${STRIPE_RESTRICTED}`, "rk [REDACTED:stripe-key]"],
        ["DB_PASS= assignment", "export DB_PASS=hunter22", "export DB_PASS=[REDACTED]"],
        ["ENCRYPTION_KEY= assignment", fake("ENCRYPTION_KEY: ", "0f1e2d", "3c4b5a"), "ENCRYPTION_KEY: [REDACTED]"],
        ["mysql -p<password>", "mysql -u root -pS3cretPw app", "mysql -u root -p[REDACTED] app"],
        ["mysqldump -p'<password>'", "mysqldump -h db -u root -p'two words' app", "mysqldump -h db -u root -p[REDACTED] app"],
        ["GitLab PAT", `token ${GITLAB}`, "token [REDACTED:gitlab-token]"],
        ["npm token", `//registry.npmjs.org/:_authToken ${NPM}`, "//registry.npmjs.org/:_authToken [REDACTED:npm-token]"],
        ["Google API key", `key=${GOOGLE}`, "key=[REDACTED:google-api-key]"],
        ["ghp_ token followed by _suffix", `${GHP}_suffix`, "[REDACTED:github-token]_suffix"],
        ["quoted multi-word password", '"password": "correct horse battery staple"', '"password": "[REDACTED]"'],
        ["single-quoted multi-word secret", "secret: 'it is a secret'", "secret: '[REDACTED]'"],
        ["double-quoted value containing an apostrophe", `password="it's my pass"`, 'password="[REDACTED]"'],
    ])("masks %s", (_name, input, expected) => {
        const {text, count} = redactSecrets(input);
        expect(text).toBe(expected);
        expect(count).toBeGreaterThan(0);
    });

    test.each([
        "input_token: 1234",
        '"output_token": 980',
        "secret: true",
        '{"token": null, "password": false}',
        "mysql -u root -p app",
        "git@github.com:org/repo.git",
        "ssh://git@bastion.example.com:22/srv",
        "http://localhost:8080/path?q=1",
        "postgres://app:${DB_PASSWORD}@db:5432/app",
        "The Authorization header is required",
        "Basic authentication is enabled",
        "cookie: none set",
        "sort_key=name and cache_key=user",
    ])("keeps non-secret text: %s", (input) => {
        expect(redactSecrets(input)).toEqual({text: input, count: 0});
    });

    test("stays linear on 200KB adversarial input for every rule", () => {
        const size = 200_000;
        const fill = (unit: string) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
        const inputs = [
            // Shapes that stalled the old generic key=value rule for 30s+ each.
            fill("a."), fill("a-"), fill("Ab0_-"), fill("eyJa-"), "eyJ" + fill("A"),
            // Near-misses for each rule: the anchor matches but the rest fails late.
            fill("-----BEGIN A "), fill(fake("-----BEGIN ", "PRIVATE KEY-----")), fill("AKIA"), fill("ghp_a"),
            fill("glpat-"), fill("npm_a"), fill("AIza"), fill("sk_live_"), fill("sk-"), fill("xoxb-"),
            fill("cwpu_api_"), "eyJaaaaaaaaa.eyJ" + fill("a-"), fill("eyJaaaaaaaaa."),
            fill("a://"), "a://b:" + fill("c"), fill("a.a://"), fill("Bearer "), "Bearer" + fill(" "),
            fill("Authorization: "), "Authorization:" + fill(" "), fill("Cookie: "), "Cookie: " + fill("a"),
            fill("mysql "), "mysql " + fill("-x "), fill("password:"), 'password:"' + fill("a"),
            fill('password="'), fill("token: 1"), "secret" + fill(" "), fill("A_KEY "), "A_PASS" + fill(" "),
        ];
        const started = performance.now();
        for (const input of inputs) redactSecrets(input);
        expect(performance.now() - started).toBeLessThan(1000);
    });
});

describe("redactSecretsDeep", () => {
    test("masks strings at any depth and keeps other values", () => {
        const {value, count} = redactSecretsDeep({
            a: `x ${GHP}`,
            n: 3,
            ok: true,
            none: null,
            list: [{b: `password=topsecret1`}, 5],
        });
        expect(value).toEqual({
            a: "x [REDACTED:github-token]",
            n: 3,
            ok: true,
            none: null,
            list: [{b: "password=[REDACTED]"}, 5],
        });
        expect(count).toBe(2);
    });
});

describe("daily report upload body", () => {
    test("redacts every text field of the coding session payload", () => {
        const payload = {
            schema: "2.0",
            date: "2026-11-05",
            author: "dev@example.com",
            generated_at: "2026-11-05T10:00:00Z",
            include_conversation: true,
            summary: `rotated ${AWS_KEY}`,
            totals: {sessions: 1, agents: ["codex"], messages: {}, files_changed: 1, cost: {USD: 1}},
            usage_breakdown: [],
            model_usage: {},
            repos: [],
            sessions: [{
                session_id: "s1",
                cwd: `/tmp/${CAWPLAN_KEY}`,
                qa_tool_outputs: [`Authorization: Bearer ${"t".repeat(32)}`],
                human_inputs: [{
                    category: "direction",
                    content: `use ${OPENAI}`,
                    assistant_message: `set GITHUB_TOKEN=${GHP}`,
                    raw_block: PEM,
                    file_changes: [{path: `secrets/${SLACK}.txt`}],
                }],
            }],
            human_inputs: [{category: "decision", content: `jwt ${JWT}`, session_id: "s1"}],
        } as unknown as DailyApiJson;

        const {body, redactions} = buildDailyReportUploadBody(payload);
        const serialized = JSON.stringify(body);

        for (const secret of [AWS_KEY, CAWPLAN_KEY, OPENAI, GHP, "MIIEowIBAAKCAQEAx", SLACK, JWT, "t".repeat(32)]) {
            expect(serialized).not.toContain(secret);
        }
        expect(redactions).toBe(8);
        expect(body.author).toBe("dev@example.com");
        expect(body.sessions[0]!.session_id).toBe("s1");
        // The caller's report object is left untouched.
        expect(payload.summary).toContain(AWS_KEY);
    });
});
