import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

const _require = createRequire(import.meta.url);

export interface SkillRoleDefinition {
    members_key: string;
    all?: boolean;
    include_common?: boolean;
    skills?: string[];
}

export interface SkillRolesConfig {
    common: string[];
    roles: Record<string, SkillRoleDefinition>;
    optional: string[];
}

export interface ProductMember {
    user_id?: string;
}

export interface ProductWithMembers {
    name?: string;
    unique_id?: string;
    members?: Record<string, ProductMember[] | undefined>;
}

export interface DetectedRole {
    role: string;
    products: string[];
}

export function loadSkillRolesConfig(): SkillRolesConfig {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return _require(resolve(__dirname, "../../config/skill-roles.json")) as SkillRolesConfig;
}

export function roleNames(config: SkillRolesConfig): string[] {
    return Object.keys(config.roles);
}

// Every skill reachable through any role. This is what an owner (or --all) gets.
export function allRoleSkills(config: SkillRolesConfig): string[] {
    const skills = new Set(config.common);
    for (const role of Object.values(config.roles)) {
        for (const skill of role.skills ?? []) skills.add(skill);
    }
    return [...skills].sort();
}

export function skillsForRoles(config: SkillRolesConfig, roles: string[]): string[] {
    const skills = new Set<string>();
    for (const roleName of roles) {
        const role = config.roles[roleName];
        if (!role) throw new Error(`Unknown role "${roleName}". Valid roles: ${roleNames(config).join(", ")}`);
        if (role.all) return allRoleSkills(config);
        if (role.include_common !== false) {
            for (const skill of config.common) skills.add(skill);
        }
        for (const skill of role.skills ?? []) skills.add(skill);
    }
    return [...skills].sort();
}

export function parseRoleList(input: string, config: SkillRolesConfig): string[] {
    const roles = [...new Set(input.split(",").map((role) => role.trim().toLowerCase()).filter(Boolean))];
    if (roles.length === 0) throw new Error(`--role needs at least one of: ${roleNames(config).join(", ")}`);
    const unknown = roles.filter((role) => !config.roles[role]);
    if (unknown.length > 0) {
        throw new Error(`Unknown role(s): ${unknown.join(", ")}. Valid roles: ${roleNames(config).join(", ")}`);
    }
    return roles;
}

// Product membership is configured per product; a user's roles are the union across products.
export function detectRoles(
    config: SkillRolesConfig,
    userId: string,
    products: ProductWithMembers[],
): DetectedRole[] {
    const detected: DetectedRole[] = [];
    for (const [role, definition] of Object.entries(config.roles)) {
        const matched = products
            .filter((product) =>
                (product.members?.[definition.members_key] ?? []).some((member) => member?.user_id === userId)
            )
            .map((product) => product.name || product.unique_id || "unknown product");
        if (matched.length > 0) detected.push({role, products: matched});
    }
    return detected;
}

// Skills from this repo that are installed but no longer part of the target set.
// Optional skills are opt-in installs and are never pruned.
export function skillsToPrune(installed: string[], target: string[], optional: string[]): string[] {
    const keep = new Set([...target, ...optional]);
    return [...new Set(installed)].filter((skill) => !keep.has(skill)).sort();
}
