import { describe, expect, test } from "vitest";
import { knowledgeChoiceLabel, renderMarkdownPreview, stringifyKnowledgeOutput } from "../src/lib/knowledge/terminal-markdown.js";

describe("knowledge terminal display boundaries", () => {
  test("escapes every C1 control in JSON without changing parsed data", () => {
    const content = String.fromCharCode(...Array.from({length: 33}, (_, i) => 0x7f + i));
    const value = {content, nested: ["\x1b[2J", "\u009d52;c;canary\u009c"], text: "normal\n\t\u6587\u4ef6"};
    const output = stringifyKnowledgeOutput(value);
    expect(JSON.parse(output)).toEqual(value);
    expect([...output].some((char) => char.charCodeAt(0) >= 0x7f && char.charCodeAt(0) <= 0x9f)).toBe(false);
    expect(output).not.toContain("\x1b");
  });

  test("strips product/module labels and leaves the stable selected ID unchanged", () => {
    const product = {unique_id: "product-1", name: "Product\x1b]52;c;canary\x07"};
    const choice = {name: knowledgeChoiceLabel(product.name, product.unique_id), value: product.unique_id};
    expect(choice).toEqual({name: "Product", value: "product-1"});
    expect(knowledgeChoiceLabel("Module\x1b[2J (Dataset\x1b[8m)")).toBe("Module (Dataset)");
    expect(knowledgeChoiceLabel(undefined, "fallback-id")).toBe("fallback-id");
  });

  test("the preview function itself rejects controls without caller pre-sanitization", async () => {
    const output = await renderMarkdownPreview("## Title\n\n\x1b]52;c;canary\x07safe\x1b[2J", 6, 12);
    expect(output).not.toContain("canary");
    expect(output).not.toContain("\x1b]52");
    expect(output).not.toContain("\x1b[2J");
    expect(output).toContain("safe");
  });
});
