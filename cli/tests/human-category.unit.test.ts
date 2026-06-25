import {describe, expect, test} from "vitest";
import {classifyHumanInput} from "../src/lib/collect/aggregators/human-category";

describe("classifyHumanInput", () => {
    test("decision — English keyword", () => {
        expect(classifyHumanInput("Let's decide to use approach A")).toBe("decision");
    });
    test("decision — Chinese keyword", () => {
        expect(classifyHumanInput("定了，就按方案A来")).toBe("decision");
    });
    test("planning — English keyword", () => {
        expect(classifyHumanInput("Let's roadmap the next sprint")).toBe("planning");
    });
    test("planning — Chinese keyword", () => {
        expect(classifyHumanInput("我们拆分一下，分三个步骤来做")).toBe("planning");
    });
    test("correction — English keyword", () => {
        expect(classifyHumanInput("This is broken, please fix the bug")).toBe("correction");
    });
    test("correction — Chinese keyword", () => {
        expect(classifyHumanInput("这里有问题，报错了")).toBe("correction");
    });
    test("direction — default for unrecognized", () => {
        expect(classifyHumanInput("帮我实现一个登录功能")).toBe("direction");
    });
    test("direction — empty string", () => {
        expect(classifyHumanInput("")).toBe("direction");
    });
    test("decision takes priority over correction when both match", () => {
        expect(classifyHumanInput("决定不修复这个bug了")).toBe("decision");
    });
});
