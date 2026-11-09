/**
 * Client-side secret redaction for session reports. Daily reports carry raw
 * prompts, assistant replies, tool output, paths and cwd; anything shaped like
 * a credential is masked before the payload leaves the machine.
 *
 * Prompts, assistant messages and tool output are not truncated, so every rule
 * must stay linear on adversarial input (long base64url runs, minified JS):
 * anchor on a literal, bound every repeat that can fail after a long scan, and
 * never put an unbounded optional prefix in front of the anchor.
 */

/** Returns the replacement text, or null to keep the match unchanged (and uncounted). */
type Replacer = (match: string, ...groups: (string | undefined)[]) => string | null;

interface RedactionRule {
    pattern: RegExp;
    replace: string | Replacer;
}

const KEY_NAMES = "password|passphrase|passwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret";

// Values that are config flags or placeholders rather than secrets: `secret: true`, `token=${GITHUB_TOKEN}`, `<password>`.
const NOT_A_SECRET = String.raw`(?![$<{\[])(?!(?:true|false|null|nil|none|undefined)\b)`;

// Starts a match only at the beginning of a base64url-ish run, so a failing
// match is attempted once per run instead of once per `-` inside it.
const RUN_START = "(?<![A-Za-z0-9_-])";

// Order matters: whole PEM blocks and specific token shapes first, so the
// generic key=value rule does not leave half of a known token behind.
const RULES: RedactionRule[] = [
    {
        // A truncated block (no END line) is masked through to the end of the text.
        pattern: /-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,64}PRIVATE KEY-----|$)/g,
        replace: "[REDACTED:private-key]",
    },
    {pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}(?![0-9A-Za-z])/g, replace: "[REDACTED:aws-access-key]"},
    // No trailing \b: `ghp_<36>_suffix` must still be masked.
    {pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{22,255})/g, replace: "[REDACTED:github-token]"},
    {pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g, replace: "[REDACTED:gitlab-token]"},
    {pattern: /\bnpm_[A-Za-z0-9]{36,}/g, replace: "[REDACTED:npm-token]"},
    {pattern: /\bAIza[0-9A-Za-z_-]{35}/g, replace: "[REDACTED:google-api-key]"},
    {pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, replace: "[REDACTED:stripe-key]"},
    {pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, replace: "[REDACTED:api-key]"},
    {pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: "[REDACTED:slack-token]"},
    {pattern: /\bcwpu_api_[A-Za-z0-9_-]{8,}/g, replace: "[REDACTED:cawplan-api-key]"},
    {
        pattern: new RegExp(`${RUN_START}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]*`, "g"),
        replace: "[REDACTED:jwt]",
    },
    {
        // scheme://user:password@host, any scheme (postgres, redis, https, amqp, ...).
        pattern: new RegExp(`\\b([a-z][a-z0-9+.-]{1,31}://[^\\s:/?#@]{0,256}:)${NOT_A_SECRET}[^\\s/?#@]{1,256}@`, "gi"),
        replace: "$1[REDACTED]@",
    },
    {pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, replace: "$1[REDACTED]"},
    {
        // Basic, Digest, token, ... — Bearer values are already masked above.
        pattern: /\b((?:Proxy-)?Authorization["']?\s*[:=]\s*["']?(?:[A-Za-z]+[ \t]+)?)(?!\[REDACTED)[^\s"']{8,}/gi,
        replace: "$1[REDACTED]",
    },
    {
        // The whole header value; a cookie list always carries at least one `name=value`.
        pattern: /\b((?:Set-)?Cookie["']?\s*:\s*["']?)(?=[^\r\n"';=]{1,256}=)[^\r\n"']{1,4096}/gi,
        replace: "$1[REDACTED]",
    },
    {
        // mysql -pSECRET / mysqldump -u root -p'SECRET'; a bare `-p` prompts and is kept.
        pattern: /\b((?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]{0,256}?\s-p)("[^"\n]{1,256}"|'[^'\n]{1,256}'|[^\s"']+)/g,
        replace: "$1[REDACTED]",
    },
    {
        // password=..., "api_key": "...", GITHUB_TOKEN=... — anchored on the key name, so the
        // key must end in one of KEY_NAMES (`max_tokens: 4096` is kept). A quoted value is
        // masked whole, so `"password": "correct horse battery staple"` leaks no words.
        pattern: new RegExp(
            `(${KEY_NAMES})(["']?\\s*[:=]\\s*)(?:` +
                `"${NOT_A_SECRET}([^"\\r\\n]{1,256})"|` +
                `'${NOT_A_SECRET}([^'\\r\\n]{1,256})'|` +
                // Unterminated or over-long quoted values fall back to masking the first word.
                `(["']?)${NOT_A_SECRET}([^\\s"'\`&,;]{4,}))`,
            "gi",
        ),
        replace: (_match, key, sep, doubleQuoted, singleQuoted, bareQuote, bare) => {
            const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
            // Token counts (`input_token: 1234`) are usage stats, not credentials.
            if (/token$/i.test(key ?? "") && /^\d+$/.test(value)) return null;
            if (doubleQuoted !== undefined) return `${key}${sep}"[REDACTED]"`;
            if (singleQuoted !== undefined) return `${key}${sep}'[REDACTED]'`;
            return `${key}${sep}${bareQuote}[REDACTED]`;
        },
    },
    {
        // Upper-case env assignments whose name ends in _KEY / _PASS / _PWD (STRIPE_KEY=, DB_PASS=).
        pattern: new RegExp(`(?<=[A-Z0-9])(_(?:KEY|PASS|PWD)\\s*[:=]\\s*["']?)${NOT_A_SECRET}[^\\s"'\`&,;]{4,}`, "g"),
        replace: "$1[REDACTED]",
    },
];

function applyRule(text: string, rule: RedactionRule): {text: string; count: number} {
    let count = 0;
    const {replace} = rule;
    // A single pass per rule: counting happens inside the replacer instead of a separate match().
    const result = text.replace(rule.pattern, (match: string, ...args: unknown[]) => {
        const groups = args.slice(0, -2) as (string | undefined)[];
        if (typeof replace === "function") {
            const replaced = replace(match, ...groups);
            if (replaced === null) return match;
            count++;
            return replaced;
        }
        count++;
        return replace.replace(/\$(\d)/g, (_, index: string) => groups[Number(index) - 1] ?? "");
    });
    return {text: result, count};
}

export function redactSecrets(text: string): {text: string; count: number} {
    let count = 0;
    let result = text;
    for (const rule of RULES) {
        const applied = applyRule(result, rule);
        count += applied.count;
        result = applied.text;
    }
    return {text: result, count};
}

/** Returns a copy of `value` with every string (at any depth) redacted, plus the number of masked secrets. */
export function redactSecretsDeep<T>(value: T): {value: T; count: number} {
    let count = 0;
    const walk = (node: unknown): unknown => {
        if (typeof node === "string") {
            const redacted = redactSecrets(node);
            count += redacted.count;
            return redacted.text;
        }
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === "object") {
            return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
        }
        return node;
    };
    const redacted = walk(value) as T;
    return {value: redacted, count};
}
