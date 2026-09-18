"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Download,
  ExternalLink,
  FileText,
  FileType2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { MarkdownEditor, MarkdownView } from "@/components/markdown-editor";
import type {
  JournalDocument,
  JournalMarkdownDocument,
} from "@/lib/types";

type DocumentsPayload = {
  document?: JournalDocument;
  documents?: JournalDocument[];
  error?: string;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function JournalDocuments({ tradeId }: { tradeId: string }) {
  const [documents, setDocuments] = useState<JournalDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedId) ?? null,
    [documents, selectedId],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadDocuments() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/journal/trades/${tradeId}/documents`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as DocumentsPayload;
        if (!response.ok || !payload.documents) {
          throw new Error(payload.error || "Unable to load documents.");
        }
        setDocuments(payload.documents);
        setSelectedId(payload.documents[0]?.id ?? null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(toErrorMessage(loadError, "Unable to load documents."));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadDocuments();
    return () => controller.abort();
  }, [tradeId]);

  function beginCreate() {
    setError("");
    setDraftTitle("");
    setDraftMarkdown("");
    setEditorMode("create");
  }

  function beginEdit(document: JournalMarkdownDocument) {
    setError("");
    setDraftTitle(document.title);
    setDraftMarkdown(document.contentMarkdown);
    setEditorMode("edit");
  }

  function cancelEdit() {
    if (saving) return;
    setEditorMode(null);
    setError("");
  }

  async function saveMarkdown(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const isEditing = editorMode === "edit" && selectedDocument?.kind === "markdown";
      const endpoint = isEditing
        ? `/api/journal/trades/${tradeId}/documents/${selectedDocument.id}`
        : `/api/journal/trades/${tradeId}/documents`;
      const response = await fetch(endpoint, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEditing ? {} : { kind: "markdown" }),
          title: draftTitle,
          contentMarkdown: draftMarkdown,
        }),
      });
      const payload = (await response.json()) as DocumentsPayload;
      if (!response.ok || !payload.document) {
        throw new Error(payload.error || "Unable to save the document.");
      }

      const savedDocument = payload.document;
      setDocuments((current) =>
        isEditing
          ? current.map((document) =>
              document.id === savedDocument.id ? savedDocument : document,
            )
          : [savedDocument, ...current],
      );
      setSelectedId(savedDocument.id);
      setEditorMode(null);
    } catch (saveError) {
      setError(toErrorMessage(saveError, "Unable to save the document."));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPdf(file: File) {
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("kind", "pdf");
      formData.set("file", file);
      const response = await fetch(
        `/api/journal/trades/${tradeId}/documents`,
        { method: "POST", body: formData },
      );
      const payload = (await response.json()) as DocumentsPayload;
      if (!response.ok || !payload.document) {
        throw new Error(payload.error || "Unable to upload the PDF.");
      }

      const uploadedDocument = payload.document;
      setDocuments((current) => [uploadedDocument, ...current]);
      setSelectedId(uploadedDocument.id);
      setEditorMode(null);
    } catch (uploadError) {
      setError(toErrorMessage(uploadError, "Unable to upload the PDF."));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeDocument(document: JournalDocument) {
    if (!window.confirm(`Delete “${document.title}”?`)) return;

    setDeletingId(document.id);
    setError("");
    try {
      const response = await fetch(
        `/api/journal/trades/${tradeId}/documents/${document.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as DocumentsPayload;
      if (!response.ok) {
        throw new Error(payload.error || "Unable to delete the document.");
      }

      const removedIndex = documents.findIndex((item) => item.id === document.id);
      const nextDocuments = documents.filter((item) => item.id !== document.id);
      setDocuments(nextDocuments);
      if (selectedId === document.id) {
        const nextIndex = Math.min(removedIndex, nextDocuments.length - 1);
        setSelectedId(nextDocuments[nextIndex]?.id ?? null);
        setEditorMode(null);
      }
    } catch (deleteError) {
      setError(toErrorMessage(deleteError, "Unable to delete the document."));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section aria-label="Journal documents" className="journal-documents">
      <div className="journal-documents-header">
        <div className="panel-heading">
          <h2>Documents</h2>
          <p>Research, reports, and supporting notes for this journal item</p>
        </div>
        <div className="journal-documents-actions">
          <button
            className="button-secondary"
            disabled={editorMode !== null || saving}
            onClick={beginCreate}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            New Markdown
          </button>
          <button
            className="button-primary"
            disabled={uploading || editorMode !== null || saving}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Upload aria-hidden="true" size={16} />
            {uploading ? "Uploading…" : "Upload PDF"}
          </button>
          <input
            ref={fileInputRef}
            accept="application/pdf,.pdf"
            className="sr-only"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadPdf(file);
            }}
          />
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {loading ? (
        <p className="journal-documents-status" role="status">
          Loading documents…
        </p>
      ) : (
        <div className="journal-documents-workspace">
          <aside aria-label="Documents" className="journal-documents-list">
            {documents.length === 0 ? (
              <p className="journal-documents-empty">No documents yet.</p>
            ) : (
              documents.map((document) => (
                <div
                  className={`journal-document-list-item${selectedId === document.id ? " journal-document-list-item-selected" : ""}`}
                  key={document.id}
                >
                  <button
                    aria-pressed={selectedId === document.id}
                    className="journal-document-select"
                    onClick={() => {
                      setSelectedId(document.id);
                      setEditorMode(null);
                      setError("");
                    }}
                    type="button"
                  >
                    {document.kind === "pdf" ? (
                      <FileType2 aria-hidden="true" size={18} />
                    ) : (
                      <FileText aria-hidden="true" size={18} />
                    )}
                    <span>
                      <strong>{document.title}</strong>
                      <small>
                        {document.kind === "pdf"
                          ? `PDF · ${formatFileSize(document.sizeBytes)}`
                          : "Markdown"}
                        {` · ${dateFormatter.format(new Date(document.createdAt))}`}
                      </small>
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${document.title}`}
                    className="icon-button journal-document-delete"
                    disabled={deletingId === document.id}
                    onClick={() => void removeDocument(document)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              ))
            )}
          </aside>

          <div className="journal-document-preview">
            {editorMode ? (
              <MarkdownDocumentForm
                content={draftMarkdown}
                mode={editorMode}
                saving={saving}
                title={draftTitle}
                onCancel={cancelEdit}
                onContentChange={setDraftMarkdown}
                onSubmit={saveMarkdown}
                onTitleChange={setDraftTitle}
              />
            ) : selectedDocument?.kind === "markdown" ? (
              <MarkdownDocumentPreview
                document={selectedDocument}
                onEdit={() => beginEdit(selectedDocument)}
              />
            ) : selectedDocument?.kind === "pdf" ? (
              <PdfDocumentPreview document={selectedDocument} />
            ) : (
              <div className="journal-document-preview-empty">
                <FileText aria-hidden="true" size={28} />
                <p>Create a Markdown document or upload a PDF to get started.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MarkdownDocumentForm({
  content,
  mode,
  saving,
  title,
  onCancel,
  onContentChange,
  onSubmit,
  onTitleChange,
}: {
  content: string;
  mode: "create" | "edit";
  saving: boolean;
  title: string;
  onCancel: () => void;
  onContentChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
}) {
  return (
    <form className="journal-document-form" onSubmit={onSubmit}>
      <div className="grid gap-2">
        <label className="field-label" htmlFor="journal-document-title">
          Title
        </label>
        <input
          autoFocus
          className="input"
          id="journal-document-title"
          maxLength={140}
          required
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </div>
      <MarkdownEditor
        id="journal-document-markdown"
        label="Document"
        value={content}
        onChange={onContentChange}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button className="button-primary" disabled={saving} type="submit">
          <Save aria-hidden="true" size={16} />
          {saving
            ? "Saving…"
            : mode === "create"
              ? "Create document"
              : "Save document"}
        </button>
        <button
          className="button-secondary"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          <X aria-hidden="true" size={16} />
          Cancel
        </button>
      </div>
    </form>
  );
}

function MarkdownDocumentPreview({
  document,
  onEdit,
}: {
  document: JournalMarkdownDocument;
  onEdit: () => void;
}) {
  return (
    <article className="journal-markdown-document">
      <div className="journal-document-preview-header">
        <div>
          <span>Markdown</span>
          <h3>{document.title}</h3>
        </div>
        <button
          aria-label={`Edit ${document.title}`}
          className="icon-button"
          onClick={onEdit}
          type="button"
        >
          <Pencil aria-hidden="true" size={16} />
        </button>
      </div>
      <MarkdownView
        emptyMessage="This document is empty."
        value={document.contentMarkdown}
      />
    </article>
  );
}

function PdfDocumentPreview({
  document,
}: {
  document: Extract<JournalDocument, { kind: "pdf" }>;
}) {
  return (
    <article className="journal-pdf-document">
      <div className="journal-document-preview-header">
        <div>
          <span>PDF · {formatFileSize(document.sizeBytes)}</span>
          <h3>{document.title}</h3>
        </div>
        <div className="journal-document-preview-actions">
          <a
            className="button-secondary"
            href={document.contentUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" size={16} />
            Open
          </a>
          <a className="button-secondary" href={document.downloadUrl}>
            <Download aria-hidden="true" size={16} />
            Download
          </a>
        </div>
      </div>
      <iframe
        className="journal-pdf-frame"
        src={document.contentUrl}
        title={`${document.title} PDF preview`}
      />
      <p className="journal-pdf-fallback">
        If the preview does not load, {" "}
        <a href={document.contentUrl} rel="noreferrer" target="_blank">
          open the PDF in a new tab
        </a>
        .
      </p>
    </article>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
