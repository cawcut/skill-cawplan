import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { getProductOverview } from "../src/commands/products.js";
import * as http from "../src/lib/http.js";
import * as cache from "../src/lib/cache.js";

const PRODUCT = "019fb1ff-d547-741f-bfa2-405386d04d5b";

describe("products overview", () => {
  beforeEach(() => {
    vi.spyOn(cache, "getCache").mockReturnValue(undefined);
    vi.spyOn(cache, "setCache").mockImplementation(() => {});
    vi.spyOn(cache, "buildScopedCacheKey").mockResolvedValue("products:overview:test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns raw {code, msg, data} envelope from API", async () => {
    const payload = {
      code: "SUCCESS",
      msg: "success",
      data: { name: "CawCut", description: "Video generation product" },
    };
    vi.spyOn(http, "cawplanRequest").mockResolvedValue(payload);

    const result = await getProductOverview(PRODUCT);
    expect(result).toEqual(payload);
    expect(http.cawplanRequest).toHaveBeenCalledWith({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/overview`,
    });
  });

  test("uses cache when present", async () => {
    const cached = { code: "SUCCESS", msg: "success", data: { name: "Cached" } };
    vi.spyOn(cache, "getCache").mockReturnValue(cached);
    const request = vi.spyOn(http, "cawplanRequest");

    const result = await getProductOverview(PRODUCT);
    expect(result).toEqual(cached);
    expect(request).not.toHaveBeenCalled();
  });
});
