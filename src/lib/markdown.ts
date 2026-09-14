import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

// Only HTML nodes can contain comments. Code and escaped examples are left alone.
// Keep all other HTML as raw text so react-markdown's safe defaults still apply.
export function remarkHideComments() {
  return (tree: Root) => {
    function visit(node: Nodes) {
      if (node.type === "html") {
        node.value = node.value.replace(/<!--[\s\S]*?-->/g, "");
      }
      if ("children" in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}

const previewProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkHideComments);

// Tooltips must use the same Markdown syntax as full views: commented images
// must not load, and comment examples in code must remain visible.
export function getMarkdownPreview(markdown: string) {
  const tree = previewProcessor.parse(markdown);
  previewProcessor.runSync(tree);
  const preview: { image: { alt: string; src: string } | null; text: string } = {
    image: null,
    text: "",
  };

  function textContent(node: Nodes): string {
    if (node.type === "image") {
      if (!preview.image && isSupportedImageSrc(node.url)) {
        preview.image = { alt: node.alt || "Journal entry image", src: node.url };
      }
      return node.alt || "";
    }
    if (node.type === "definition") return "";
    if ("value" in node) return node.value;
    if ("children" in node) {
      const separator = ["root", "blockquote", "list", "listItem", "table", "tableRow"].includes(node.type)
        ? " "
        : "";
      return node.children.map(textContent).join(separator);
    }
    return node.type === "break" ? " " : "";
  }

  const text = textContent(tree).replace(/\s+/g, " ").trim();
  preview.text = !text ? "No description." : text.length > 140 ? `${text.slice(0, 137)}...` : text;
  return preview;
}

function isSupportedImageSrc(src: string) {
  return src.startsWith("/") || src.startsWith("data:image/") || /^https?:\/\//i.test(src);
}
