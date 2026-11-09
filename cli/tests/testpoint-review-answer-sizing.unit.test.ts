import {describe, expect, test, vi} from "vitest";
import {testPointReviewHtml} from "../src/lib/testpoint-review/testpoint-review-html.js";
import {createFixtureReviewState} from "../src/lib/testpoint-review/fixtures.js";

// Execute the emitted browser functions so these checks cover behavior, rather
// than just matching the presence of CSS or JavaScript strings.
function sizing(input: any, withObserver = true) {
  const html = testPointReviewHtml(createFixtureReviewState({productId: "p", requirementId: "r"}));
  const source = html.slice(html.indexOf("function autoGrow(el)"), html.indexOf("function wireQuestionAnswers()"));
  const wrap = {querySelector: () => input};
  let notify: (entries: any[]) => void;
  const observe = vi.fn();
  const events: Record<string, () => void> = {};
  const frames: (() => void)[] = [];
  const functions = new Function("document", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "window",
    source + "; return {autoGrow, wireQuestionAnswerSizes};")(
    {querySelectorAll: () => [wrap]},
    withObserver ? class {constructor(callback: typeof notify) {notify = callback;} observe = observe;} : undefined,
    () => ({paddingLeft: "9px", paddingRight: "9px"}),
    (callback: () => void) => frames.push(callback),
    {addEventListener: (name: string, callback: () => void) => {events[name] = callback;}},
  );
  return {...functions, wrap, observe, frames, events, resize: (width: number) => notify([{target: wrap, contentRect: {width}}])};
}

function field(value = "") {
  return {value, style: {height: "356px"}, clientWidth: 350, clientHeight: 32, offsetHeight: 34, scrollHeight: 356};
}

describe("question answer sizing", () => {
  test("empty answers clear stale height without measuring wrapped placeholder", () => {
    const input = field();
    const read = vi.fn(() => 356);
    Object.defineProperty(input, "scrollHeight", {get: read});
    sizing(input).autoGrow(input);
    expect(input.style.height).toBe("auto");
    expect(read).not.toHaveBeenCalled();
  });

  test("nonempty answers grow and shrink with content, including border-box borders", () => {
    const input = field("answer");
    const {autoGrow} = sizing(input);
    autoGrow(input);
    expect(input.style.height).toBe("358px");
    input.scrollHeight = 32;
    autoGrow(input);
    expect(input.style.height).toBe("34px");
    input.value = "";
    autoGrow(input);
    expect(input.style.height).toBe("auto");
  });

  test("defers content measurement when there is no usable text width", () => {
    const input = {...field("prefilled"), clientWidth: 18};
    const read = vi.fn(() => 10000);
    Object.defineProperty(input, "scrollHeight", {get: read});
    sizing(input).autoGrow(input);
    expect(input.style.height).toBe("auto");
    expect(read).not.toHaveBeenCalled();
  });

  test("first observer notification corrects prefilled answers; height-only notifications do not loop", () => {
    const input = field("prefilled");
    const api = sizing(input);
    api.wireQuestionAnswerSizes();
    expect(api.observe).toHaveBeenCalledWith(api.wrap);
    input.scrollHeight = 32;
    api.resize(350);
    expect(input.style.height).toBe("34px");
    input.scrollHeight = 100;
    api.resize(350);
    expect(input.style.height).toBe("34px");
    api.resize(150);
    expect(input.style.height).toBe("102px");
    input.scrollHeight = 32;
    api.resize(350);
    expect(input.style.height).toBe("34px");
  });

  test("fallback corrects initial layout on the next frame and follows window resizing", () => {
    const input = field("prefilled");
    const api = sizing(input, false);
    api.wireQuestionAnswerSizes();
    input.scrollHeight = 32;
    api.frames[0]();
    expect(input.style.height).toBe("34px");
    input.scrollHeight = 100;
    api.events.resize();
    expect(input.style.height).toBe("102px");
  });
});
