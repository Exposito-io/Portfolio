// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";

afterEach(cleanup);

describe("MarkdownView", () => {
  it("hides inline and multiline comments while retaining surrounding Markdown", () => {
    const { container } = render(<MarkdownView value={[
      "**Before**<!-- inline secret --> and _after_<!-- second secret -->.",
      "",
      "<!-- multiline secret",
      "![hidden image](/hidden.png)",
      "# hidden heading",
      "",
      "still hidden",
      "-->",
      "",
      "> Visible <!-- nested secret -->quote",
      "",
      "- Visible <!-- list secret -->item",
      "",
      "| Column |",
      "| --- |",
      "| Value <!-- table secret --> |",
      "",
      "Inline <!-- multiline secret",
      "continues here -->ending.",
    ].join("\n")} />);

    expect(container).not.toHaveTextContent("secret");
    expect(container).not.toHaveTextContent("hidden");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toHaveTextContent("Before");
    expect(container.querySelector("em")).toHaveTextContent("after");
    expect(container.querySelector("blockquote")).toHaveTextContent("Visible quote");
    expect(container.querySelector("li")).toHaveTextContent("Visible item");
    expect(container.querySelector("td")).toHaveTextContent("Value");
    expect(container).toHaveTextContent("Inline ending.");
  });

  it("preserves literal comments inside code spans and fenced or indented code", () => {
    const { container } = render(<MarkdownView value={[
      "`<!-- inline example -->` and ``<!-- `backticks` -->``",
      "",
      "```html",
      "<!-- fenced",
      "example -->",
      "```",
      "",
      "~~~html",
      "<!-- tilde example -->",
      "~~~",
      "",
      "    <!-- indented example -->",
      "",
      "\\<!-- escaped example -->",
      "",
      "&lt;!-- entity example --&gt;",
    ].join("\n")} />);

    expect(Array.from(container.querySelectorAll("code"), (code) => code.textContent)).toEqual([
      "<!-- inline example -->",
      "<!-- `backticks` -->",
      "<!-- fenced\nexample -->\n",
      "<!-- tilde example -->\n",
      "<!-- indented example -->\n",
    ]);
    expect(container).toHaveTextContent("<!-- escaped example -->");
    expect(container).toHaveTextContent("<!-- entity example -->");
  });

  it("continues escaping raw HTML and filtering unsafe Markdown URLs", () => {
    const { container } = render(<MarkdownView value={[
      '<div><!-- secret -->Visible HTML</div>',
      "",
      '<script>alert("unsafe")</script>',
      "",
      '<img src="x" onerror="alert(1)">',
      "",
      '[unsafe link](javascript:alert%281%29)',
      "",
      '[safe link](https://example.com)',
    ].join("\n")} />);

    expect(container).toHaveTextContent("<div>Visible HTML</div>");
    expect(container).not.toHaveTextContent("secret");
    expect(container.querySelector("script, [onerror]")).toBeNull();
    expect(screen.getByText("unsafe link")).toHaveAttribute("href", "");
    expect(screen.getByRole("link", { name: "safe link" })).toHaveAttribute("href", "https://example.com");
  });

  it("hides comment-only content and preserves incomplete syntax as text", () => {
    const { container, rerender } = render(<MarkdownView value="<!-- secret -->" />);
    expect(container.textContent).toBe("");
    rerender(<MarkdownView value={"Visible\n\n<!-- unfinished\nsecret"} />);
    expect(container).toHaveTextContent("<!-- unfinished secret");
  });

  it("keeps comments in the editable source while the live preview hides them", () => {
    function EditorPreview() {
      const [value, setValue] = useState("");
      return <>
        <MarkdownEditor id="description" label="Description" value={value} onChange={setValue} />
        <MarkdownView value={value} />
      </>;
    }
    const { container } = render(<EditorPreview />);
    const source = "Visible <!-- preserved secret -->\n\n`<!-- example -->`";
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: source } });
    expect(screen.getByRole("textbox")).toHaveValue(source);
    expect(container.querySelector(".markdown-view")).not.toHaveTextContent("preserved secret");
    expect(container.querySelector("code")).toHaveTextContent("<!-- example -->");
  });
});
