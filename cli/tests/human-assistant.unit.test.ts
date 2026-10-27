import { describe, expect, test } from "vitest";
import {
  appendAssistantMessage,
  extractAssistantTextFromBlocks,
  joinAssistantMessages,
} from "../src/lib/collect/aggregators/human-assistant.js";

describe("human-assistant helpers", () => {
  test("joinAssistantMessages joins non-empty parts", () => {
    expect(joinAssistantMessages(["first", "second"])).toBe("first\n\nsecond");
    expect(joinAssistantMessages([])).toBeUndefined();
  });

  test("appendAssistantMessage appends with blank line separator", () => {
    expect(appendAssistantMessage("hello", "world")).toBe("hello\n\nworld");
    expect(appendAssistantMessage(undefined, "world")).toBe("world");
  });

  test("extractAssistantTextFromBlocks keeps text blocks only", () => {
    expect(
      extractAssistantTextFromBlocks([
        { type: "text", text: "answer" },
        { type: "tool_use", name: "Edit", input: {} },
        { type: "output_text", text: "done" },
      ])
    ).toBe("answer\ndone");
  });
});
