"use client";

import { useRef, useState } from "react";
import { Bold, ImagePlus, Italic, Link as LinkIcon, List } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownEditorProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  minHeight?: string;
  required?: boolean;
  enableImageUpload?: boolean;
};

export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  minHeight = "min-h-32",
  required = false,
  enableImageUpload = false,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);

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

  function insertText(text: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(`${value}\n${text}`);
      return;
    }

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const prefix = value.slice(0, selectionStart);
    const suffix = value.slice(selectionEnd);
    const separatorBefore = prefix && !prefix.endsWith("\n") ? "\n\n" : "";
    const separatorAfter = suffix && !suffix.startsWith("\n") ? "\n\n" : "";
    const nextValue = `${prefix}${separatorBefore}${text}${separatorAfter}${suffix}`;
    onChange(nextValue);

    window.requestAnimationFrame(() => {
      const cursor = selectionStart + separatorBefore.length + text.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  async function uploadImage(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.set("image", file);

      const response = await fetch("/api/journal/images", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to upload image.");
      insertText(payload.image.markdown);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Unable to upload image.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
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
        {enableImageUpload ? (
          <>
            <button
              type="button"
              title="Upload image"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={15} aria-hidden="true" />
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadImage(file);
              }}
            />
          </>
        ) : null}
      </div>
      {uploadError ? <div className="alert alert-error">{uploadError}</div> : null}
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
