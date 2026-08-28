import { describe, expect, test, vi, afterEach } from "vitest";
import { getVersionTicket } from "../src/commands/tickets.js";
import * as http from "../src/lib/http.js";
import {
  normalizeTicketDetailFieldsCsv,
  TICKET_DETAIL_FIELD_TOKENS,
} from "../src/lib/ticket-detail-fields.js";

const PRODUCT = "019fb1ff-d547-741f-bfa2-405386d04d5b";
const VERSION = "019fb1ff-d547-741f-bfa2-405386d04d6c";
const TICKET = "019fb1ff-d547-741f-bfa2-405386d04d7d";

describe("normalizeTicketDetailFieldsCsv", () => {
  test("accepts all allowed tokens", () => {
    expect(normalizeTicketDetailFieldsCsv(TICKET_DETAIL_FIELD_TOKENS.join(","))).toBe(
      TICKET_DETAIL_FIELD_TOKENS.join(","),
    );
  });

  test("strips whitespace around tokens", () => {
    expect(normalizeTicketDetailFieldsCsv(" labels , children ")).toBe("labels,children");
  });

  test("rejects unknown tokens", () => {
    expect(() => normalizeTicketDetailFieldsCsv("labels,nope")).toThrow(/invalid fields: nope/);
  });

  test("rejects empty csv", () => {
    expect(() => normalizeTicketDetailFieldsCsv("  ,  ")).toThrow(/empty value/);
  });
});

describe("getVersionTicket", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("requests full detail when fields omitted", async () => {
    const payload = {
      code: "SUCCESS",
      message: "success",
      data: { unique_id: TICKET, labels: [{ name: "Feature" }], children: [] },
    };
    const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue(payload);

    const result = await getVersionTicket(PRODUCT, VERSION, TICKET);
    expect(result).toEqual(payload);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/tickets/${TICKET}`,
      query: undefined,
    });
  });

  test("passes fields query for sparse fieldset", async () => {
    const request = vi.spyOn(http, "cawplanRequest").mockResolvedValue({ code: "SUCCESS" });

    await getVersionTicket(PRODUCT, VERSION, TICKET, { fields: "labels, children" });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: `/api/v1/public/openapi/product/${PRODUCT}/versions/${VERSION}/tickets/${TICKET}`,
      query: { fields: "labels,children" },
    });
  });
});
