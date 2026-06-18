const TOPICS = new Set([
    "bug",
    "ux",
    "security",
    "performance",
    "new_feature",
    "improvement",
    "docs",
    "infra",
    "other",
]);

const TOPIC_ALIASES: Record<string, string> = {
    bugs: "bug",
    fix: "bug",
    fixes: "bug",
    ui: "ux",
    user_experience: "ux",
    perf: "performance",
    feature: "new_feature",
    "new feature": "new_feature",
    "new-feature": "new_feature",
    newfeature: "new_feature",
    new_functionality: "new_feature",
    improve: "improvement",
    enhancement: "improvement",
    documentation: "docs",
    doc: "docs",
    infrastructure: "infra",
};

function normalizeTopic(raw?: string | null): string {
    const value = String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/[：:]+$/g, "");
    const normalized = TOPIC_ALIASES[value] ?? value;
    return TOPICS.has(normalized) ? normalized : "";
}

function extractAnnotatedTopic(content: string): string {
    const text = String(content ?? "").trim();
    if (!text) return "";
    const patterns = [
        /\[\s*(topic\s*[:=].*?)\s*\]/i,
        /\{\s*(topic\s*[:=].*?)\s*\}/i,
        /<!--\s*(topic\s*[:=].*?)\s*-->/i,
    ];
    for (const pattern of patterns) {
        const m = text.match(pattern);
        if (!m?.[1]) continue;
        const rawMeta = m[1];
        const parts = rawMeta.split(/[;,]/);
        for (const part of parts) {
            const pair = part.split(/[:=]/);
            if (pair.length < 2) continue;
            const key = String(pair[0] ?? "").trim().toLowerCase().replace(/-/g, "_");
            const value = String(pair.slice(1).join(":") ?? "").trim().replace(/^['"]|['"]$/g, "");
            if (key === "topic") {
                const normalized = normalizeTopic(value);
                if (normalized) return normalized;
            }
        }
    }
    return "";
}

function hasAny(text: string, keywords: string[]): boolean {
    return keywords.some((k) => text.includes(k));
}

export function inferHumanInputTopic(params: {
    content?: string | null;
    category?: string | null;
    sessionTitle?: string | null;
    topic?: string | null;
}): string {
    const normalizedExisting = normalizeTopic(params.topic);
    if (normalizedExisting) return normalizedExisting;

    const content = String(params.content ?? "");
    const annotated = extractAnnotatedTopic(content);
    if (annotated) return annotated;

    const category = String(params.category ?? "").toLowerCase();
    const contentText = content.toLowerCase();
    const titleText = String(params.sessionTitle ?? "").toLowerCase();

    const strongSecurityTerms = [
        "security", "vulnerability", "exploit", "secret", "credential", "token leak",
        "oauth", "xss", "csrf", "lfi", "path traversal", "安全", "漏洞", "泄露",
    ];
    const bugTerms = [
        "bug", "fix", "regress", "error", "crash", "exception", "broken", "failure",
        "修复", "问题", "错误", "回归", "崩溃", "异常", "失败",
    ];
    const accessControlTerms = [
        "auth", "authorization", "authentication", "permission", "permissions", "access denied",
        "token", "认证", "鉴权", "权限", "登录",
    ];
    const performanceTerms = [
        "performance", "latency", "slow", "timeout", "oom", "memory", "fps", "throughput",
        "卡顿", "性能", "耗时", "内存", "延迟", "慢",
    ];
    const newFeatureTerms = [
        "new feature", "feature", "capability", "support for", "add support",
        "新增", "新功能", "新特性", "接入",
    ];
    const uxTerms = [
        "ux", "ui", "figma", "interaction", "layout", "button", "modal", "toast",
        "style", "visual", "dashboard", "交互", "样式", "按钮", "弹窗", "布局", "视觉", "设计稿",
    ];
    const docsTerms = ["readme", "doc", "docs", "documentation", "spec", "文档", "说明"];
    const infraTerms = [
        "ci", "build", "deploy", "workflow", "pipeline", "env", "docker", "k8s",
        "构建", "部署", "环境", "流水线",
    ];
    const improvementTerms = [
        "improve", "improvement", "enhance", "refactor", "cleanup", "optimize",
        "改进", "增强", "重构", "整理", "优化", "迁移",
    ];

    if (hasAny(contentText, strongSecurityTerms)) return "security";
    if (category === "correction" || hasAny(contentText, bugTerms)) return "bug";
    if (hasAny(contentText, accessControlTerms)) return "security";
    if (hasAny(contentText, performanceTerms)) return "performance";
    if (hasAny(contentText, newFeatureTerms)) return "new_feature";
    if (hasAny(contentText, uxTerms)) return "ux";
    if (hasAny(contentText, docsTerms)) return "docs";
    if (hasAny(contentText, infraTerms)) return "infra";
    if (hasAny(contentText, improvementTerms)) return "improvement";

    if (hasAny(titleText, [...strongSecurityTerms, ...accessControlTerms])) return "security";
    if (hasAny(titleText, performanceTerms)) return "performance";
    if (hasAny(titleText, newFeatureTerms)) return "new_feature";
    if (hasAny(titleText, uxTerms)) return "ux";

    return "other";
}
