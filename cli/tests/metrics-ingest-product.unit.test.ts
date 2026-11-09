import {describe, expect, test} from "vitest";
import {prepareIngestItems} from "../src/commands/metrics.js";

describe("prepareIngestItems", () => {
    test("fills dimensions.product from --product_id and keeps other dimensions", () => {
        const out = prepareIngestItems([{domain: "d", metric: "m", value: 1, dimensions: {plan: "pro"}}], "p1");
        expect(out[0].dimensions).toEqual({plan: "pro", product: "p1"});
    });

    test("accepts items that already name the product", () => {
        const out = prepareIngestItems([{domain: "d", metric: "m", value: 1, dimensions: {product: "p1"}}]);
        expect(out[0].dimensions).toEqual({product: "p1"});
    });

    test("rejects an item without a product", () => {
        expect(() => prepareIngestItems([{domain: "d", metric: "m", value: 1}])).toThrow(/product is required/);
        expect(() => prepareIngestItems([{domain: "d", metric: "m", dimensions: {product: " "}}])).toThrow(/items\[0\]/);
    });

    test("rejects an item whose product conflicts with --product_id", () => {
        expect(() => prepareIngestItems([{dimensions: {product: "p2"}}], "p1")).toThrow(/conflicts/);
    });

    test("rejects non-object items", () => {
        expect(() => prepareIngestItems(["x"], "p1")).toThrow(/must be an object/);
    });
});
