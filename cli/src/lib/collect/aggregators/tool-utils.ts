import { isAbsolute, relative, resolve, sep } from "node:path";

export interface FileDelta {
    path: string;
    added: number;
    deleted: number;
}

function normalizeRepoPath(path: string): string {
    return path.split(sep).join("/");
}

function isPathUnderRoot(absPath: string, root: string): boolean {
    const normalizedRoot = resolve(root);
    const normalizedPath = resolve(absPath);
    if (normalizedPath === normalizedRoot) return true;
    return normalizedPath.startsWith(normalizedRoot + sep);
}

/** When filePath is inside repoRoot, return a repo-relative path with forward slashes. */
export function relativizePathToRepo(filePath: string, repoRoot?: string): string {
    const trimmed = filePath.trim();
    if (!trimmed) return trimmed;
    const root = (repoRoot ?? "").trim();
    if (!root) return normalizeRepoPath(trimmed);

    const resolvedRoot = resolve(root);
    const resolvedPath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(resolvedRoot, trimmed);
    if (!isPathUnderRoot(resolvedPath, resolvedRoot)) {
        return normalizeRepoPath(trimmed);
    }
    return normalizeRepoPath(relative(resolvedRoot, resolvedPath));
}

export function relativizeFileChanges(
    changes: FileDelta[] | undefined,
    repoRoot?: string
): FileDelta[] | undefined {
    if (!changes?.length) return undefined;
    const merged = mergeFileDeltas(
        changes.map((change) => ({
            ...change,
            path: relativizePathToRepo(change.path, repoRoot),
        }))
    );
    return merged.length > 0 ? merged : undefined;
}

export function aggregateFileChanges(changes: Array<FileDelta | undefined>): FileDelta[] | undefined {
    const merged = mergeFileDeltas(changes.flatMap((change) => change ?? []));
    return merged.length > 0 ? merged : undefined;
}

export function mergeFileDeltas(deltas: FileDelta[]): FileDelta[] {
    const byPath = new Map<string, FileDelta>();
    for (const delta of deltas) {
        if (!delta.path) continue;
        appendFileDelta(byPath, delta);
    }
    return [...byPath.values()];
}

export function appendFileDelta(byPath: Map<string, FileDelta>, delta: FileDelta): void {
    const path = delta.path.trim();
    if (!path) return;
    const existing = byPath.get(path);
    if (!existing) {
        byPath.set(path, {
            path,
            added: Math.max(0, delta.added),
            deleted: Math.max(0, delta.deleted),
        });
        return;
    }
    existing.added += Math.max(0, delta.added);
    existing.deleted += Math.max(0, delta.deleted);
}

export function summarizeFileDeltas(deltas: FileDelta[]): {
    files: number;
    added: number;
    deleted: number;
    file_changes: FileDelta[];
} {
    const merged = mergeFileDeltas(deltas);
    return {
        files: merged.length,
        added: merged.reduce((sum, delta) => sum + delta.added, 0),
        deleted: merged.reduce((sum, delta) => sum + delta.deleted, 0),
        file_changes: merged,
    };
}

export function countLines(value: unknown): number {
    if (typeof value !== "string" || value.length === 0) return 0;
    return value.split("\n").length;
}

export function countDiffLines(diff: string): { added: number; deleted: number } {
    let added = 0;
    let deleted = 0;
    for (const line of diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) added++;
        else if (line.startsWith("-")) deleted++;
    }
    return { added, deleted };
}

const PATCH_FILE_RE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/;

export function parsePatchDeltas(patch: string): FileDelta[] {
    const byPath = new Map<string, FileDelta>();
    let current = "";

    for (const line of patch.split("\n")) {
        const m = line.match(PATCH_FILE_RE);
        if (m) {
            current = m[1]?.trim() ?? "";
            if (current && !byPath.has(current)) {
                byPath.set(current, { path: current, added: 0, deleted: 0 });
            }
            continue;
        }
        if (!current) continue;
        const delta = byPath.get(current);
        if (!delta) continue;
        if (line.startsWith("+") && !line.startsWith("+++")) delta.added++;
        if (line.startsWith("-") && !line.startsWith("---")) delta.deleted++;
    }

    return [...byPath.values()].filter((d) => d.added > 0 || d.deleted > 0);
}

const PATH_KEYS = ["path", "file_path", "target_file", "target_notebook"] as const;

export function extractPathFromInput(input: Record<string, unknown>): string | null {
    for (const key of PATH_KEYS) {
        const val = input[key];
        if (typeof val === "string" && val.trim()) return val.trim();
    }
    return null;
}

export function estimateToolDeltas(
    toolName: string,
    input: Record<string, unknown>,
): FileDelta[] {
    const name = toolName.toLowerCase();

    if (name === "applypatch") {
        const patch = input["patch"] ?? input["input"];
        return typeof patch === "string" ? parsePatchDeltas(patch) : [];
    }

    const path = extractPathFromInput(input);

    if (name === "edit" || name === "strreplace" || name === "editnotebook") {
        if (!path) return [];
        return [{ path, added: countLines(input["new_string"]), deleted: countLines(input["old_string"]) }];
    }

    if (name === "multiedit") {
        const edits = input["edits"] as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(edits) || edits.length === 0) return path ? [{ path, added: 0, deleted: 0 }] : [];
        const firstPath = extractPathFromInput(edits[0]) ?? path;
        if (!firstPath) return [];
        let added = 0;
        let deleted = 0;
        for (const e of edits) {
            added += countLines(e["new_string"]);
            deleted += countLines(e["old_string"]);
        }
        return [{ path: firstPath, added, deleted }];
    }

    if (name === "write") {
        if (!path) return [];
        const content = input["contents"] ?? input["content"] ?? input["new_string"];
        return [{ path, added: countLines(content), deleted: 0 }];
    }

    if (name === "delete") {
        if (!path) return [];
        return [{ path, added: 0, deleted: 1 }];
    }

    return [];
}
