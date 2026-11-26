/** A successful HTTP status can still carry a rejected CawPlan write. */
export function printWriteResult(result: unknown): void {
  if (!result || typeof result !== "object" || !("code" in result) || typeof result.code !== "string") {
    throw new Error("Invalid API response: missing result code");
  }
  if (result.code !== "SUCCESS") {
    const message = "msg" in result ? result.msg : "message" in result ? result.message : undefined;
    throw new Error(typeof message === "string" && message ? `${result.code}: ${message}` : result.code);
  }
  console.log(JSON.stringify(result, null, 2));
}
