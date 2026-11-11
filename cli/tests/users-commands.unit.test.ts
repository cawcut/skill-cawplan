import { afterEach, describe, expect, test, vi } from "vitest";
import { getCurrentUser } from "../src/commands/users.js";
import * as http from "../src/lib/http.js";
import * as cache from "../src/lib/cache.js";

describe("users me", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns the raw {code, msg, data} envelope for the signed-in user", async () => {
    const payload = {
      code: "SUCCESS",
      msg: "success",
      data: { unique_id: "01983fa5-0000-7000-8000-000000000000", email: "someone@example.com" },
    };
    vi.spyOn(http, "cawplanRequest").mockResolvedValue(payload);

    await expect(getCurrentUser()).resolves.toEqual(payload);
    expect(http.cawplanRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/public/openapi/users/me",
    });
  });

  test("never reads or writes the cache, so a re-login cannot return a stale identity", async () => {
    const getCache = vi.spyOn(cache, "getCache");
    const setCache = vi.spyOn(cache, "setCache");
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "SUCCESS", msg: "success", data: {} });

    await getCurrentUser();
    expect(getCache).not.toHaveBeenCalled();
    expect(setCache).not.toHaveBeenCalled();
  });
});
