export interface User {
  id: number;
  /** The account identity. There is no separate username. */
  email: string;
  isAdmin: boolean;
  emailVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A user as the admin list returns it: the base user plus admin-only flags. */
export interface AdminUser extends User {
  twoFactorEnabled: boolean;
  /** A mailed account-deletion link is still live for this account. */
  deletionRequested: boolean;
  /** The last usage report put the account at or past one of its limits. */
  overQuota: boolean;
}

/** One filtered page of the admin user list. */
export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AuthResponse {
  user: User;
  tokens: Tokens;
}

/** A sign-in that passed the password step but still owes a second factor. */
export interface TwoFactorChallenge {
  challengeId: string;
  expiresAt: string;
}

/**
 * Reply to POST /auth/login: either a finished session or a pending challenge.
 * The challenge form deliberately carries no user or tokens.
 */
export type LoginResponse = AuthResponse | { twoFactor: TwoFactorChallenge };

export function isTwoFactorChallenge(
  res: LoginResponse,
): res is { twoFactor: TwoFactorChallenge } {
  return "twoFactor" in res && res.twoFactor != null;
}

/** One account's consumption against its limits. A limit of 0 is unlimited. */
export interface QuotaUsage {
  storageBytes: number;
  storageLimit: number;
  todos: number;
  todoLimit: number;
  projects: number;
  projectLimit: number;
  notes: number;
  noteLimit: number;
  contexts: number;
  contextLimit: number;
  tags: number;
  tagLimit: number;
  recurring: number;
  recurringLimit: number;
}

/** One account's row in the periodically rebuilt usage report. */
export interface UsageSnapshot {
  userId: number;
  email: string;
  storageBytes: number;
  todos: number;
  projects: number;
  notes: number;
  contexts: number;
  tags: number;
  recurring: number;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  generatedAt: string;
  /** Percentages are derived server-side against the limits in force now.
   *  -1 means the resource is unlimited. */
  storagePercent: number;
  todoPercent: number;
  projectPercent: number;
  notePercent: number;
  contextPercent: number;
  tagPercent: number;
  recurringPercent: number;
  /** The highest of the above: how close this account is to its nearest
   *  limit. Over 100 means it is past one. */
  worstPercent: number;
}

export interface UsageReport {
  generatedAt?: string;
  usageReportAtMinute: number;
  limits: {
    StorageBytes: number;
    Todos: number;
    Projects: number;
    Notes: number;
    Contexts: number;
    Tags: number;
    Recurring: number;
  };
  total: number;
  page: number;
  pageSize: number;
  accounts: UsageSnapshot[];
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt?: string;
  recoveryCodesRemaining: number;
}

export interface TwoFactorEnrolment {
  enrolmentId: string;
  secret: string;
  otpauthUrl: string;
  /** data: URI of the QR code, rendered by the server. */
  qr: string;
}

export type TodoState = "active" | "deferred" | "completed";
export type ProjectState = "active" | "hidden" | "completed";

export interface Todo {
  id: number;
  contextId: number;
  projectId?: number;
  recurringTodoId?: number;
  description: string;
  due?: string;
  showFrom?: string;
  completedAt?: string;
  state: TodoState;
  starred: boolean;
  position: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  state: ProjectState;
  position: number;
  defaultContextId?: number;
  completedAt?: string;
  lastReviewed?: string;
  openCount: number;
  doneCount: number;
  /** Every action filed under the project, whatever its state. */
  totalCount: number;
  createdAt: string;
  updatedAt: string;
}

export type RecurrencePeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringTodo {
  id: number;
  contextId: number;
  projectId?: number;
  description: string;
  state: string;
  period: RecurrencePeriod;
  everyN: number;
  weekdays: string;
  dayOfMonth: number;
  monthOfYear: number;
  showFromDays: number;
  startFrom?: string;
  endDate?: string;
  /** Inherited by every action the pattern spawns. */
  tags: string[];
  lastSpawnedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface Note {
  id: number;
  projectId?: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Preference {
  dateFormat: string;
  timeZone: string;
  locale: string;
  theme: "light" | "dark" | "system";
  weekStart: number;
  reviewPeriod: number;
  showFromDays: number;
  autoDeleteAttachments: boolean;
  updatedAt: string;
}

export interface Attachment {
  id: number;
  todoId: number;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface AttachmentWithTodo extends Attachment {
  todoDescription: string;
  todoState: string;
}

export interface MonthCount {
  month: string;
  count: number;
}

export interface ContextCount {
  contextId: number;
  name: string;
  open: number;
}

export interface Stats {
  totalActions: number;
  active: number;
  deferred: number;
  completed: number;
  completionRate: number;
  avgCompletionDays: number;
  completedLast30: number;
  completedLast365: number;
  perMonth: MonthCount[];
  perContext: ContextCount[];
  oldestOpenDays: number;
  projectsActive: number;
  projectsCompleted: number;
  projectsHidden: number;
}

export type ContextState = "active" | "hidden";

export interface Context {
  id: number;
  name: string;
  position: number;
  state: ContextState;
  createdAt: string;
  updatedAt: string;
}

export type LegalKind = "terms" | "privacy" | "cookies";

/** One legal document as it currently stands, in the reader's language. */
export interface LegalDocument {
  kind: LegalKind;
  body: string;
  /** True when the operator replaced the text shipped with the application. */
  customised: boolean;
}

/** The operator's editor state. */
export interface LegalEditor {
  defaults: Record<string, Record<LegalKind, string>>;
  overrides: Record<string, Partial<Record<LegalKind, string>>>;
}

export type AuditOutcome = "success" | "failure";

/** One recorded event. Never holds a secret. */
export interface AuditEvent {
  id: number;
  occurredAt: string;
  action: string;
  outcome: AuditOutcome;
  actorId?: number;
  actorEmail?: string;
  targetId?: number;
  targetEmail?: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
  /** SHA-256 (hex) of an export's bytes; present only on export events. */
  hash?: string;
}

export interface AuditPage {
  items: AuditEvent[];
  total: number;
}

/** The filter the audit page sends; empty fields are omitted. */
export interface AuditFilter {
  from?: string;
  to?: string;
  actor?: string;
  action?: string;
  outcome?: string;
}
