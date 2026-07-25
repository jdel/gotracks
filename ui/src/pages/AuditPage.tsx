import { useState } from "react";
import { Download, Info, Paperclip, Search } from "lucide-react";
import { useAuditActions, useAuditLog, downloadAuditExport } from "@/hooks/useAudit";
import { PageContainer } from "@/components/PageContainer";
import { Pagination } from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  }

  async function exportAs(format: "json" | "csv") {
    setError("");
    try {
      await downloadAuditExport(applied, format);
    } catch (err) {
      setError(apiMessage(err, t("audit.exportFailed")));
    }
  }

  return (
    <PageContainer size="wide">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.audit")}</h1>
        <p className="text-sm text-muted-foreground">{t("audit.subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="audit-from">{t("audit.from")}</Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">{t("audit.to")}</Label>
          <Input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-actor">{t("audit.person")}</Label>
          <Input
            id="audit-actor"
            placeholder={t("audit.personPlaceholder")}
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-action">{t("audit.action")}</Label>
          <select
            id="audit-action"
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">{t("audit.anyAction")}</option>
            {(actions ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-outcome">{t("audit.outcome")}</Label>
          <select
            id="audit-outcome"
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">{t("audit.anyOutcome")}</option>
            <option value="success">{t("audit.success")}</option>
            <option value="failure">{t("audit.failure")}</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={apply} disabled={!dirty}>
          <Search /> {t("audit.apply")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => exportAs("csv")}>
          <Download /> {t("audit.exportCsv")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => exportAs("json")}>
          <Download /> {t("audit.exportJson")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("audit.matchCount", { count: String(data?.total ?? 0) })}
        </span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Wide content carries its own horizontal scroll rather than pushing the
          page sideways, but four columns should not need it. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3 font-medium">{t("audit.when")}</th>
              <th className="py-2 pr-3 font-medium">{t("audit.action")}</th>
              <th className="py-2 pr-3 font-medium">{t("audit.person")}</th>
              <th className="py-2 pr-3 font-medium">{t("audit.outcome")}</th>
              <th className="w-10 py-2" />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((event) => (
              <tr key={event.id} className="border-b last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap">{dateTime(event.occurredAt)}</td>
                <td className="py-2 pr-3 font-mono text-xs">{event.action}</td>
                <td className="py-2 pr-3">{describePeople(event)}</td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      event.outcome === "failure"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {t(event.outcome === "failure" ? "audit.failure" : "audit.success")}
                  </span>
                </td>
                <td className="py-2">
                  <IconButton
                    variant="ghost"
                    label={t("audit.details")}
                    onClick={() => setShowing(event)}
                  >
                    <Info />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isPending && <p className="text-sm text-muted-foreground">{t("actions.loading")}</p>}
      {!isPending && (data?.total ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">{t("audit.none")}</p>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />

      <AuditDetails event={showing} onClose={() => setShowing(null)} />
    </PageContainer>
  );
}

function AuditDetails({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const t = useT();
  const { dateTime } = useDateFmt();
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("audit.details")}</DialogTitle>
        </DialogHeader>
        <dl className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              {/* break-all so a long user agent wraps instead of widening the
                  dialog past the viewport. */}
              <dd className="col-span-2 break-all">{value}</dd>
            </div>
          ))}
          {/* Only export events carry a fingerprint. It ties this entry to the
              exact file that left the service: re-hash a copy and compare. */}
          {event.hash && <Fingerprint hash={event.hash} />}
        </dl>
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
