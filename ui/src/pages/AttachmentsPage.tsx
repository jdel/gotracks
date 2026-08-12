import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Download, ArrowUp, ArrowDown } from "lucide-react";
import { useAllAttachments, useDeleteAttachment } from "@/hooks/useSettings";
import { formatBytes } from "@/lib/usage";
import { api } from "@/lib/api";
import { downloadAttachment, downloadErrorMessage } from "@/lib/attachments";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import type { AttachmentWithTodo } from "@/lib/types";
import { SearchInput } from "@/components/SearchInput";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { Screen, HeaderBlock, Button, Chip, SkeletonList, EmptyState } from "@/components/primitives";
import { useT, useTn } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";

type SortKey = "fileName" | "todoDescription" | "size" | "createdAt";

// Hoisted to module scope so it is a stable component type across renders.
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
    <th className={cn("mono-label py-3", right ? "text-right" : "text-left", active && "text-brand dark:text-brand-ink-dark")}>
      <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-0.5">
        {label}
        {active && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}

function AttachmentActions({
  attachment,
  mobile = false,
  onDownload,
  onDelete,
}: {
  attachment: AttachmentWithTodo;
  mobile?: boolean;
  onDownload: (attachment: AttachmentWithTodo) => void;
  onDelete: (attachment: AttachmentWithTodo) => void;
}) {
  const t = useT();
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <IconButton
        variant="ghost"
        className={mobile ? "size-9" : "size-7"}
        label={t("attachments.download", { name: attachment.fileName })}
        onClick={() => onDownload(attachment)}
      >
        <Download className={mobile ? "size-4" : "size-3.5"} />
      </IconButton>
      <IconButton
        variant="ghost"
        className={mobile ? "size-9" : "size-7"}
        label={t("attachments.deleteLabel", { name: attachment.fileName })}
        onClick={() => onDelete(attachment)}
      >
        <Trash2 className={cn("text-danger", mobile ? "size-4" : "size-3.5")} />
      </IconButton>
    </div>
  );
}

function sortAttachments(rows: AttachmentWithTodo[], key: SortKey, desc: boolean): AttachmentWithTodo[] {
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
  const { user } = useAuth();
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
    if (sort === key) setDesc((d) => !d);
    else {
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
    <Screen header={<HeaderBlock title={t("nav.attachments")} avatar={initials(user?.email)} avatarLabel={t("nav.settings")} />}>
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("attachments.searchPlaceholder")}
          ariaLabel={t("attachments.searchAria")}
          className="w-full min-w-[180px] sm:w-auto sm:max-w-[300px] sm:flex-1"
        />
        <Button
          className="ml-auto"
          variant="ghost"
          disabled={doneAttachments.length === 0}
          onClick={() => setConfirmingBulk(true)}
        >
          <Trash2 className="size-4" /> {t("attachments.deleteDone", { count: doneAttachments.length })}
        </Button>
      </div>

      {downloadError && <p className="pb-3 text-sm font-medium text-danger">{downloadError}</p>}

      {isLoading ? (
        <SkeletonList />
      ) : attachments && attachments.length === 0 ? (
        <EmptyState message={t("attachments.none")} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("attachments.noMatch")} />
      ) : (
        <>
          {/* Mobile: sort control + cards. */}
          <div className="flex items-end gap-2 pb-3 md:hidden">
            <label className="min-w-0 flex-1 text-[11px] font-bold text-ink-3">
              {t("attachments.sortBy")}
              <select
                className="mt-1 h-[42px] w-full rounded-control border border-line-2 bg-surface px-3 text-sm font-medium text-ink dark:border-line-2-dark dark:bg-card-dark dark:text-ink-dark"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="fileName">{t("attachments.colFile")}</option>
                <option value="todoDescription">{t("attachments.colAction")}</option>
                <option value="size">{t("attachments.colSize")}</option>
                <option value="createdAt">{t("attachments.colUploaded")}</option>
              </select>
            </label>
            <IconButton
              variant="outline"
              className="size-[42px]"
              label={t(desc ? "attachments.sortDescending" : "attachments.sortAscending")}
              onClick={() => setDesc((c) => !c)}
            >
              {desc ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}
            </IconButton>
          </div>

          <ul className="flex flex-col gap-[9px] md:hidden">
            {rows.map((a) => (
              <li key={a.id} className="rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink dark:text-ink-dark" title={a.fileName}>
                      {a.fileName}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs font-medium text-ink-2 dark:text-ink-2-dark">
                      {a.todoDescription}
                      {a.todoState === "completed" && (
                        <span className="ml-1.5 inline-block align-middle">
                          <Chip tone="done">{t("attachments.done")}</Chip>
                        </span>
                      )}
                    </p>
                  </div>
                  <AttachmentActions attachment={a} mobile onDownload={(i) => void handleDownload(i)} onDelete={setConfirming} />
                </div>
                <div className="mono mt-3 flex items-center justify-between gap-3 border-t border-line-3 pt-2 text-[10px] text-ink-4 dark:border-line-dark">
                  <span>{formatBytes(a.size)}</span>
                  <span>{fmt.date(a.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: table in a panel. */}
          <div className="hidden rounded-panel bg-card px-5 pt-1.5 pb-3.5 shadow-card md:block dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line dark:border-line-dark">
                  <SortHeader label={t("attachments.colFile")} column="fileName" sort={sort} desc={desc} onSort={toggleSort} />
                  <SortHeader label={t("attachments.colAction")} column="todoDescription" sort={sort} desc={desc} onSort={toggleSort} />
                  <SortHeader label={t("attachments.colSize")} column="size" right sort={sort} desc={desc} onSort={toggleSort} />
                  <SortHeader label={t("attachments.colUploaded")} column="createdAt" right sort={sort} desc={desc} onSort={toggleSort} />
                  <th className="py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-line-3 last:border-0 dark:border-line-dark">
                    <td className="max-w-56 truncate py-2.5 text-[13px] font-medium text-ink dark:text-ink-dark" title={a.fileName}>
                      {a.fileName}
                    </td>
                    <td className="max-w-56 truncate py-2.5 text-[13px] font-medium text-ink-2 dark:text-ink-2-dark" title={a.todoDescription}>
                      {a.todoDescription}
                      {a.todoState === "completed" && (
                        <span className="ml-1.5 inline-block align-middle">
                          <Chip tone="done">{t("attachments.done")}</Chip>
                        </span>
                      )}
                    </td>
                    <td className="mono py-2.5 text-right text-[13px]">{formatBytes(a.size)}</td>
                    <td className="mono py-2.5 text-right text-[13px] text-ink-4">{fmt.date(a.createdAt)}</td>
                    <td className="py-2.5">
                      <AttachmentActions attachment={a} onDownload={(i) => void handleDownload(i)} onDelete={setConfirming} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

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
    </Screen>
  );
}
