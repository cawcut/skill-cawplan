import { readFile } from "node:fs/promises";

export async function readJsonBody(
  bodyFile: string | undefined,
  inlineBody: string | undefined,
): Promise<unknown> {
  if (bodyFile && inlineBody) {
    throw new Error("pass either --body-file or --body, not both");
  }
  const raw = bodyFile ? await readFile(bodyFile, "utf8") : inlineBody;
  if (!raw) {
    throw new Error("--body-file or --body is required");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`body is not valid JSON — ${(err as Error).message}`);
  }
}
