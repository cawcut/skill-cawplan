import type {HumanInput} from "../types.js";

const DECISION_WORDS = [
    "决定", "決定", "定了", "採用", "采用", "改成", "改為", "用这个", "用這個",
    "最终", "最終", "结论", "結論", "就按", "agreed", "decide", "decision",
];

const PLANNING_WORDS = [
    "计划", "計劃", "方案", "步驟", "步骤", "下一步", "roadmap", "plan", "planning", "拆分", "排期",
];

const CORRECTION_WORDS = [
    "修复", "修復", "修正", "改一下", "不对", "不對", "有问题", "有問題",
    "报错", "報錯", "错误", "錯誤", "bug", "fix", "broken", "failed",
];

export function classifyHumanInput(text: string): HumanInput["category"] {
    const lower = text.toLowerCase();
    if (DECISION_WORDS.some((w) => lower.includes(w))) return "decision";
    if (PLANNING_WORDS.some((w) => lower.includes(w))) return "planning";
    if (CORRECTION_WORDS.some((w) => lower.includes(w))) return "correction";
    return "direction";
}
