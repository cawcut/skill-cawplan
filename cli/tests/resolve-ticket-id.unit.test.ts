import { afterEach, describe, expect, test, vi } from "vitest";
import * as http from "../src/lib/http.js";
import {
  resolveTicketIdArg,
  resolveTicketUniqueIdForRoute,
} from "../src/lib/resolve-ticket-id.js";

const PRODUCT = "019d46c8-5084-7432-bbdd-f2972890d863";
const VERSION = "01a055a1-fde1-7159-983a-8d00a3f03538";
const UNIQUE = "019f1a2b-3c4d-5e6f-7890-abcdef012345";
const DISPLAY = "CAWP-20544";

describe("resolveTicketUniqueIdForRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("passes through unique_id without search", async () => {
    const request = vi.spyOn(http, "cawplanRequest");
    const resolved = await resolveTicketUniqueIdForRoute(UNIQUE, {
      productId: PRODUCT,
      versionId: VERSION,
    });
    expect(resolved).toEqual({ uniqueId: UNIQUE, resolvedFromDisplayId: false });
    expect(request).not.toHaveBeenCalled();
  });

  test("resolves display_id via tickets search", async () => {
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({
      data: [{
        unique_id: UNIQUE,
        display_id: DISPLAY,
        product_id: PRODUCT,
        version_id: VERSION,
      }],
    });

    const resolved = await resolveTicketUniqueIdForRoute(DISPLAY, {
      productId: PRODUCT,
      versionId: VERSION,
    });
    expect(resolved).toEqual({
      uniqueId: UNIQUE,
      resolvedFromDisplayId: true,
      displayId: DISPLAY,
    });
  });

  test("filters search results by product and version scope", async () => {
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({
      data: [
        {
          unique_id: "other-uuid",
          display_id: DISPLAY,
          product_id: "other-product",
          version_id: "other-version",
        },
        {
          unique_id: UNIQUE,
          display_id: DISPLAY,
          product_id: PRODUCT,
          version_id: VERSION,
        },
      ],
    });

    const resolved = await resolveTicketUniqueIdForRoute(DISPLAY, {
      productId: PRODUCT,
      versionId: VERSION,
    });
    expect(resolved.uniqueId).toBe(UNIQUE);
  });

  test("throws when display_id cannot be resolved", async () => {
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({ data: [] });
    await expect(resolveTicketUniqueIdForRoute(DISPLAY, {
      productId: PRODUCT,
      versionId: VERSION,
    })).rejects.toThrow(/No ticket found for display_id CAWP-20544/);
  });

  test("throws on ambiguous display_id matches", async () => {
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({
      data: [
        {
          unique_id: "uuid-a",
          display_id: DISPLAY,
          product_id: PRODUCT,
          version_id: VERSION,
        },
        {
          unique_id: "uuid-b",
          display_id: DISPLAY,
          product_id: PRODUCT,
          version_id: VERSION,
        },
      ],
    });
    await expect(resolveTicketUniqueIdForRoute(DISPLAY, {
      productId: PRODUCT,
      versionId: VERSION,
    })).rejects.toThrow(/Multiple tickets match display_id CAWP-20544/);
  });
});

describe("resolveTicketIdArg", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("writes a note when resolving display_id", async () => {
    vi.spyOn(http, "cawplanRequest").mockResolvedValue({
      data: [{
        unique_id: UNIQUE,
        display_id: DISPLAY,
        product_id: PRODUCT,
        version_id: VERSION,
      }],
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const uniqueId = await resolveTicketIdArg(DISPLAY, {
      productId: PRODUCT,
      versionId: VERSION,
    });

    expect(uniqueId).toBe(UNIQUE);
    expect(stderr).toHaveBeenCalledWith(
      `Note: resolved ticket display_id ${DISPLAY} to unique_id ${UNIQUE}\n`,
    );
  });
});
