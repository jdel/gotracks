import { useRef, useState, type ChangeEvent } from "react";
import { Paperclip, Trash2, Download } from "lucide-react";
import { useAttachments, useDeleteAttachment, useUploadAttachment } from "@/hooks/useSettings";
import { downloadAttachment, downloadErrorMessage } from "@/lib/attachments";
import type { Attachment } from "@/lib/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useT } from "@/lib/i18n";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentPanel({ todoId }: { todoId: number }) {
  const t = useT();
  const { data: attachments } = useAttachments(todoId, true);
  const upload = useUploadAttachment(todoId);
  const del = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<Attachment | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = "";
  }

  async function handleDownload(a: Attachment) {
    setDownloadError(null);
    try {
      await downloadAttachment(a.id, a.fileName);
    } catch (err) {
      setDownloadError(downloadErrorMessage(err, a.fileName));
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-control border border-line p-2 dark:border-line-dark">
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" className="hidden" onChange={onPick} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          <Paperclip /> {upload.isPending ? t("attach.uploading") : t("attach.attachFile")}
        </Button>
        {upload.isError && (
          <span className="text-xs font-medium text-danger">{(upload.error as Error).message}</span>
        )}
      </div>

      <ul className="space-y-1">
        {attachments?.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-xs text-ink dark:text-ink-dark">
            {/* Truncated to keep the row one line; the whole name is on hover,
                as on the attachments screen. */}
            <span className="min-w-0 flex-1 truncate" title={a.fileName}>
              {a.fileName}
            </span>
            <span className="mono shrink-0 text-ink-4 dark:text-ink-4-dark">{humanSize(a.size)}</span>
            <IconButton
              variant="ghost"
              className="size-7"
              label={t("attach.download", { name: a.fileName })}
              onClick={() => void handleDownload(a)}
            >
              <Download className="size-3" />
            </IconButton>
            <IconButton
              variant="ghost"
              className="size-7"
              label={t("attach.deleteLabel", { name: a.fileName })}
              onClick={() => setConfirming(a)}
            >
              <Trash2 className="size-3 text-danger" />
            </IconButton>
          </li>
        ))}
      </ul>
      {attachments?.length === 0 && (
        <p className="text-xs font-medium text-ink-4 dark:text-ink-4-dark">{t("attach.none")}</p>
      )}
      {downloadError && <p className="text-xs font-medium text-danger">{downloadError}</p>}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("attach.deleteTitle")}
        description={
          <>
            <strong>{confirming?.fileName}</strong> {t("attach.deleteDescBody")}
          </>
        }
        busy={del.isPending}
        onConfirm={() => {
          if (confirming) del.mutate(confirming.id);
          setConfirming(null);
        }}
      />
    </div>
  );
}
