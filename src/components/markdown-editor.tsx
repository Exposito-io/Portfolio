"use client";

import { useRef } from "react";
import { Bold, Italic, Link as LinkIcon, List } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownEditorProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  minHeight?: string;
  required?: boolean;
};

export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  minHeight = "min-h-32",
  required = false,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function applyFormat(before: string, after = "", placeholder = "text") {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selected = value.slice(selectionStart, selectionEnd) || placeholder;
    const nextValue = `${value.slice(0, selectionStart)}${before}${selected}${after}${value.slice(selectionEnd)}`;
    onChange(nextValue);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        selectionStart + before.length,
        selectionStart + before.length + selected.length,
      );
    });
  }

  function applyList() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selected = value.slice(selectionStart, selectionEnd) || "point";
    const listText = selected
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    const nextValue = `${value.slice(0, selectionStart)}${listText}${value.slice(selectionEnd)}`;
    onChange(nextValue);
  }

  return (
    <div className="grid gap-2">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="markdown-toolbar" aria-label={`${label} formatting`}>
        <button type="button" title="Bold" onClick={() => applyFormat("**", "**")}>
          <Bold size={15} aria-hidden="true" />
        </button>
        <button type="button" title="Italic" onClick={() => applyFormat("_", "_")}>
          <Italic size={15} aria-hidden="true" />
        </button>
        <button type="button" title="List" onClick={applyList}>
          <List size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Link"
          onClick={() => applyFormat("[", "](https://)", "link")}
        >
          <LinkIcon size={15} aria-hidden="true" />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        className={`input ${minHeight} resize-y leading-6`}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function MarkdownView({ value }: { value: string }) {
  if (!value.trim()) {
    return <p className="text-sm text-[#737a76]">No description yet.</p>;
  }

  return (
    <div className="markdown-view">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );
}
