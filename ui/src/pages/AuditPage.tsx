import { useState } from "react";
import { Download, Info, Paperclip, Search } from "lucide-react";
import { useAuditActions, useAuditLog, downloadAuditExport } from "@/hooks/useAudit";
import { Pagination } from "@/components/Pagination";
import { IconButton } from "@/components/IconButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/initials";
import {
  Screen,
  HeaderBlock,
  Panel,
  Chip,
  Sheet,
  Button,
  DataTable,
  SkeletonList,
} from "@/components/primitives";
import { inputClass } from "@/components/primitive-styles";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { apiMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDateFmt } from "@/lib/datefmt";
import type { AuditEvent, AuditFilter } from "@/lib/types";

const PAGE_SIZE = 50;

/**
 * Who the row is about.
 *
 * An administrator acting on somebody else is two people, and showing only the
 * one who clicked loses the half that matters — "deleted" is not a useful entry
 * without whom.
 */
function describePeople(event: AuditEvent): string {
  if (event.actorEmail && event.targetEmail && event.actorEmail !== event.targetEmail) {
    return `${event.actorEmail} → ${event.targetEmail}`;
  }
  return event.actorEmail || event.targetEmail || "—";
}

/** A date input yields "2026-07-24"; the API wants an instant. */
function dayStart(value: string): string {
  return value ? new Date(`${value}T00:00:00`).toISOString() : "";
}
function dayEnd(value: string): string {
  return value ? new Date(`${value}T23:59:59.999`).toISOString() : "";
}

/**
 * The administrator's view of the audit log.
 *
 * Four columns only, so the table reads without scrolling sideways on a laptop:
 * everything else — the address the request came from, the browser, the note —
 * lives behind the details button rather than being squeezed in.
 */
export function AuditPage() {
  const t = useT();
  const { user } = useAuth();
  const { dateTime } = useDateFmt();
  const { data: actions } = useAuditActions();

  // The draft is what the inputs edit; the applied filter is what the log is
  // asked for. They are separate because every search is a request and every
  // request is itself recorded — searching on each keystroke would write one
  // audit entry per character. Apply is the deliberate act that runs the query.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [applied, setApplied] = useState<AuditFilter>({});
  const [page, setPage] = useState(1);
  const [showing, setShowing] = useState<AuditEvent | null>(null);
  const [error, setError] = useState("");
  // On mobile the filters live in a sheet behind a "Filters" header action.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isPending } = useAuditLog(applied, page, PAGE_SIZE);

  // Whether the draft differs from what is showing, so Apply is live only when
  // pressing it would change anything.
  const draft: AuditFilter = { from: dayStart(from), to: dayEnd(to), actor, action, outcome };
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  function apply() {
    // A new search always starts at the first page: staying on page 4 of a
    // narrower result would show an empty table for no reason.
    setApplied(draft);
    setPage(1);
    setFiltersOpen(false);
  }

  async function exportAs(format: "json" | "csv") {
    setError("");
    try {
      await downloadAuditExport(applied, format);
    } catch (err) {
      setError(apiMessage(err, t("audit.exportFailed")));
    }
  }

  const detailsButton = (event: AuditEvent) => (
    <IconButton
      className="size-7"
      label={t("audit.details")}
      onClick={() => setShowing(event)}
    >
      <Info className="size-3.5 text-ink-4" />
    </IconButton>
  );

  const filterControls = (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{t("audit.from")}</span>
          <input id="audit-from" type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{t("audit.to")}</span>
          <input id="audit-to" type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{t("audit.person")}</span>
          <input
            className={inputClass}
            placeholder={t("audit.personPlaceholder")}
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{t("audit.action")}</span>
          <select className={inputClass} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t("audit.anyAction")}</option>
            {(actions ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold text-ink-3 dark:text-ink-4-dark">{t("audit.outcome")}</span>
          <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">{t("audit.anyOutcome")}</option>
            <option value="success">{t("audit.success")}</option>
            <option value="failure">{t("audit.failure")}</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={apply} disabled={!dirty}>
          <Search className="size-4" /> {t("audit.apply")}
        </Button>
        <Button variant="ghost" onClick={() => exportAs("csv")}>
          <Download className="size-4" /> {t("audit.exportCsv")}
        </Button>
        <Button variant="ghost" onClick={() => exportAs("json")}>
          <Download className="size-4" /> {t("audit.exportJson")}
        </Button>
      </div>
    </div>
  );

  return (
    <Screen
      header={
        <HeaderBlock
          title={t("nav.audit")}
          avatar={initials(user?.email)} avatarLabel={t("nav.settings")}
          metrics={[{ value: data?.total ?? 0, label: t("audit.matchingLabel") }]}
          action={
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="rounded-control bg-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/25 md:hidden"
            >
              {t("audit.filters")}
            </button>
          }
        />
      }
    >
      <Panel className="mt-4">
        {/* Desktop shows the filters inline; mobile puts them in a sheet. */}
        <div className="hidden md:block">{filterControls}</div>
        {error && <p className="text-sm font-medium text-danger">{error}</p>}

        {isPending ? (
          <SkeletonList />
        ) : (data?.total ?? 0) === 0 ? (
          <p className="text-sm font-medium text-ink-3">{t("audit.none")}</p>
        ) : (
          <DataTable
            rows={data?.items ?? []}
            rowKey={(event) => event.id}
            columns={[
              {
                key: "when",
                label: t("audit.when"),
                mono: true,
                render: (event) => (
                  <span className="whitespace-nowrap text-[11px] text-ink-4">
                    {dateTime(event.occurredAt)}
                  </span>
                ),
              },
              {
                key: "action",
                label: t("audit.action"),
                mono: true,
                render: (event) => <span className="text-[11px]">{event.action}</span>,
              },
              {
                key: "person",
                label: t("audit.person"),
                render: (event) => (
                  <span className="block max-w-56 truncate text-ink-2 dark:text-ink-2-dark">
                    {describePeople(event)}
                  </span>
                ),
              },
              {
                key: "outcome",
                label: t("audit.outcome"),
                render: (event) => (
                  <Chip tone={event.outcome === "failure" ? "danger" : "done"}>
                    {t(event.outcome === "failure" ? "audit.failure" : "audit.success")}
                  </Chip>
                ),
              },
              {
                key: "details",
                label: "",
                align: "right",
                render: (event) => detailsButton(event),
              },
            ]}
            renderCard={(event) => (
              <div
                key={event.id}
                className="flex items-start gap-2.5 rounded-card bg-card p-3 shadow-card dark:border dark:border-line-dark dark:bg-card-dark dark:shadow-none"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="mono min-w-0 truncate text-[11px] text-ink dark:text-ink-dark">
                      {event.action}
                    </span>
                    <Chip tone={event.outcome === "failure" ? "danger" : "done"}>
                      {t(event.outcome === "failure" ? "audit.failure" : "audit.success")}
                    </Chip>
                  </div>
                  <span className="truncate text-xs font-medium text-ink-2 dark:text-ink-2-dark">
                    {describePeople(event)}
                  </span>
                  <span className="mono text-[10px] text-ink-4">
                    {dateTime(event.occurredAt)}
                    {event.ip && ` · ${event.ip}`}
                  </span>
                </div>
                {detailsButton(event)}
              </div>
            )}
          />
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
      </Panel>

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t("audit.filters")}>
        {filterControls}
      </Sheet>

      <AuditDetails event={showing} onClose={() => setShowing(null)} />
    </Screen>
  );
}

function AuditDetails({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const t = useT();
  const { dateTime } = useDateFmt();
  const isDesktop = useIsDesktop();
  if (!event) return null;

  const rows: Array<[string, string]> = [
    [t("audit.when"), dateTime(event.occurredAt)],
    [t("audit.action"), event.action],
    [t("audit.outcome"), t(event.outcome === "failure" ? "audit.failure" : "audit.success")],
    [t("audit.actor"), event.actorEmail || "—"],
    [t("audit.target"), event.targetEmail || "—"],
    [t("audit.ip"), event.ip || "—"],
    [t("audit.userAgent"), event.userAgent || "—"],
    [t("audit.detail"), event.detail || "—"],
  ];

  const body = (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-3 gap-2">
          <dt className="text-muted-foreground">{label}</dt>
          {/* break-all so a long user agent wraps instead of widening the
              panel past the viewport. */}
          <dd className="col-span-2 break-all">{value}</dd>
        </div>
      ))}
      {/* Only export events carry a fingerprint. It ties this entry to the
          exact file that left the service: re-hash a copy and compare. */}
      {event.hash && <Fingerprint hash={event.hash} />}
    </dl>
  );

  // One presentation per viewport, the same rule the rest of the app follows —
  // and the same rule the filters on this page already follow. This was the
  // last centred dialog left on a phone, where a panel that arrives in the
  // middle of the screen with a small close target is the odd one out, and
  // where a user agent string has no room to wrap.
  if (!isDesktop) {
    return (
      <Sheet open onClose={onClose} title={t("audit.details")}>
        {body}
      </Sheet>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("audit.details")}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function Fingerprint({ hash }: { hash: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard is not worth an error; the hash is on screen to
      // select by hand.
    }
  }

  return (
    <div className="grid grid-cols-3 gap-2 border-t pt-2">
      <dt className="flex items-center gap-1 text-muted-foreground">
        <Paperclip className="size-3.5" /> {t("audit.fingerprint")}
      </dt>
      <dd className="col-span-2 space-y-1">
        <code className="block break-all font-mono text-xs">sha256:{hash}</code>
        <button type="button" onClick={copy} className="text-xs underline underline-offset-2">
          {copied ? t("audit.copied") : t("audit.copy")}
        </button>
        <p className="text-xs text-muted-foreground">{t("audit.fingerprintHelp")}</p>
      </dd>
    </div>
  );
}
