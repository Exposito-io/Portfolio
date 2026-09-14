import { describe, expect, it } from "vitest";

import { getMarkdownPreview } from "@/lib/markdown";

describe("chart Markdown preview", () => {
  it("omits commented text and images before choosing the visible image", () => {
    const preview = getMarkdownPreview([
      "Before<!-- inline secret --> after.",
      "",
      "<!-- multiline secret",
      "![hidden](/hidden.png)",
      "-->",
      "",
      '![visible](/visible.png "Caption")',
    ].join("\n"));
    expect(preview).toEqual({
      image: { alt: "visible", src: "/visible.png" },
      text: "Before after. visible",
    });
  });

  it("retains comment code examples without treating their images as real images", () => {
    expect(getMarkdownPreview([
      "`<!-- inline -->`",
      "",
      "```html",
      "<!-- fenced",
      "![example](/example.png) -->",
      "```",
    ].join("\n"))).toEqual({
      image: null,
      text: "<!-- inline --> <!-- fenced ![example](/example.png) -->",
    });
  });

  it("retains formatting text, fallback, length limit, and image URL restrictions", () => {
    expect(getMarkdownPreview("**Bold** and _italic_ [link](https://example.com)").text).toBe("Bold and italic link");
    expect(getMarkdownPreview("<!-- hidden -->")).toEqual({ image: null, text: "No description." });
    expect(getMarkdownPreview("x".repeat(141)).text).toBe(`${"x".repeat(137)}...`);
    expect(getMarkdownPreview("![unsafe](javascript:alert%281%29)").image).toBeNull();
    expect(getMarkdownPreview("![safe](https://example.com/image.png)").image?.src).toBe("https://example.com/image.png");
  });
});
