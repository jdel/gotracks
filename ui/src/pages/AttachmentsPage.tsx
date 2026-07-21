import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Download, ArrowUp, ArrowDown, Paperclip } from "lucide-react";
import { useAllAttachments, useDeleteAttachment } from "@/hooks/useSettings";
import { formatBytes } from "@/lib/usage";
import { api } from "@/lib/api";
import { downloadAttachment, downloadErrorMessage } from "@/lib/attachments";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AttachmentWithTodo } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { useT, useTn } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

type SortKey = "fileName" | "todoDescription" | "size" | "createdAt";

// Hoisted to module scope so it is a stable component type across renders
// (react-hooks/static-components); render-scoped values are passed as props.
function SortHeader({
  label,
  column,
  right,
  sort,
  desc,
  onSort,
}: {
  label: string;
  column: SortKey;
  right?: boolean;
  sort: SortKey;
  desc: boolean;
  onSort: (column: SortKey) => void;
}) {
  const active = sort === column;
  return (
    <th className={cn("px-2 py-1 font-normal", right ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-0.5 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}

function sortAttachments(
  rows: AttachmentWithTodo[],
  key: SortKey,
  desc: boolean,
): AttachmentWithTodo[] {
  const sorted = [...rows].sort((a, b) => {
    switch (key) {
      case "size":
        return a.size - b.size;
      case "createdAt":
        return a.createdAt.localeCompare(b.createdAt);
      case "todoDescription":
        return a.todoDescription.localeCompare(b.todoDescription);
      default:
        return a.fileName.localeCompare(b.fileName);
    }
  });
  if (desc) sorted.reverse();
  return sorted;
}

export function AttachmentsPage() {
  const t = useT();
  const fmt = useDateFmt();
  const tn = useTn();
  const qc = useQueryClient();
  const { data: attachments, isLoading } = useAllAttachments();
  const del = useDeleteAttachment();
  const [sort, setSort] = useState<SortKey>("size");
  const [desc, setDesc] = useState(true);
  const [confirming, setConfirming] = useState<AttachmentWithTodo | null>(null);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [query, setQuery] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const doneAttachments = attachments?.filter((a) => a.todoState === "completed") ?? [];

  function toggleSort(key: SortKey) {
    if (sort === key) {
      setDesc((d) => !d);
    } else {
      setSort(key);
      setDesc(true);
    }
  }

  async function handleDownload(a: AttachmentWithTodo) {
    setDownloadError(null);
    try {
      await downloadAttachment(a.id, a.fileName);
    } catch (err) {
      setDownloadError(downloadErrorMessage(err, a.fileName));
    }
  }

  async function handleBulkDelete() {
    setBulkBusy(true);
    await Promise.all(doneAttachments.map((a) => api.del(`/attachments/${a.id}`)));
    await qc.invalidateQueries({ queryKey: ["attachments"] });
    setBulkBusy(false);
    setConfirmingBulk(false);
  }

  const needle = query.trim().toLowerCase();
  const filtered = (attachments ?? []).filter(
    (a) =>
      a.fileName.toLowerCase().includes(needle) ||
      a.todoDescription.toLowerCase().includes(needle),
  );
  const rows = sortAttachments(filtered, sort, desc);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.attachments")}</h1>
<p className="text-sm text-muted-foreground">{t("attachments.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("attachments.files")}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={doneAttachments.length === 0}
            onClick={() => setConfirmingBulk(true)}
          >
            <Trash2 /> {t("attachments.deleteDone", { count: doneAttachments.length })}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t("attachments.searchPlaceholder")}
            ariaLabel={t("attachments.searchAria")}
          />
          {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          {downloadError && <p className="text-sm text-destructive">{downloadError}</p>}

          {attachments && attachments.length === 0 && (
            <p className="text-sm text-muted-foreground">
              <Paperclip className="mr-1 inline size-4" />
              {t("attachments.none")}
            </p>
          )}
          {attachments && attachments.length > 0 && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("attachments.noMatch")}</p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <SortHeader label={t("attachments.colFile")} column="fileName" sort={sort} desc={desc} onSort={toggleSort} />
                    <SortHeader label={t("attachments.colAction")} column="todoDescription" sort={sort} desc={desc} onSort={toggleSort} />
                    <SortHeader label={t("attachments.colSize")} column="size" right sort={sort} desc={desc} onSort={toggleSort} />
                    <SortHeader label={t("attachments.colUploaded")} column="createdAt" right sort={sort} desc={desc} onSort={toggleSort} />
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="max-w-56 truncate px-2 py-1" title={a.fileName}>
                        {a.fileName}
                      </td>
                      <td className="max-w-56 truncate px-2 py-1 text-muted-foreground" title={a.todoDescription}>
                        {a.todoDescription}
                        {a.todoState === "completed" && (
                          <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                            {t("attachments.done")}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatBytes(a.size)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                        {fmt.date(a.createdAt)}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex justify-end gap-0.5">
                          <IconButton
                            variant="ghost"
                            className="size-7"
                            label={t("attachments.download", { name: a.fileName })}
                            onClick={() => void handleDownload(a)}
                          >
                            <Download className="size-3" />
                          </IconButton>
                          <IconButton
                            variant="ghost"
                            className="size-7"
                            label={t("attachments.deleteLabel", { name: a.fileName })}
                            onClick={() => setConfirming(a)}
                          >
                            <Trash2 className="size-3 text-destructive" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("attachments.deleteTitle")}
        description={
          <>
            <strong>{confirming?.fileName}</strong>, {t("attachments.attachedTo")}{" "}
            <strong>{confirming?.todoDescription}</strong>, {t("attachments.willDelete")}
          </>
        }
        busy={del.isPending}
        onConfirm={() => {
          if (confirming) del.mutate(confirming.id);
          setConfirming(null);
        }}
      />

      <ConfirmDialog
        open={confirmingBulk}
        onOpenChange={setConfirmingBulk}
        title={t("attachments.bulkTitle")}
        description={
          <>
            <strong>{tn(doneAttachments.length, "attachments.bulkCount")}</strong>{" "}
            {t("attachments.bulkDescBody")}
          </>
        }
        busy={bulkBusy}
        onConfirm={() => void handleBulkDelete()}
      />
    </div>
  );
}
