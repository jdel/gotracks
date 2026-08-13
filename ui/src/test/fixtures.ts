import type {
  Attachment,
  Context,
  Project,
  RecurringTodo,
  Todo,
  User,
} from "@/lib/types";

/**
 * Rows shaped like the server's, with every field the type demands.
 *
 * Hand-rolled fixtures drift: a test once asserted that a new action inherited
 * no project, and passed against the unfixed code because its own fixture had
 * quietly dropped `projectId`. Typed builders make that a compile error rather
 * than a green test — a response-shape change breaks the fixtures instead of
 * being absorbed by them.
 *
 * Every builder takes an override, so a test states only what it is about:
 *
 *     aTodo({ description: "buy paint", starred: true })
 */

const CREATED = "2026-08-01T00:00:00Z";

export function aContext(over: Partial<Context> = {}): Context {
  return { id: 1, name: "home", state: "active", position: 1, createdAt: CREATED, updatedAt: CREATED, ...over };
}

export function aProject(over: Partial<Project> = {}): Project {
  return {
    id: 10,
    name: "garden",
    description: "",
    state: "active",
    position: 1,
    openCount: 0,
    doneCount: 0,
    totalCount: 0,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...over,
  };
}

export function aTodo(over: Partial<Todo> = {}): Todo {
  return {
    id: 100,
    contextId: 1,
    description: "buy paint",
    state: "active",
    starred: false,
    position: 1,
    tags: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...over,
  };
}

export function aRecurrence(over: Partial<RecurringTodo> = {}): RecurringTodo {
  return {
    id: 200,
    contextId: 1,
    description: "water the plants",
    state: "active",
    period: "weekly",
    everyN: 1,
    weekdays: "1",
    dayOfMonth: 0,
    monthOfYear: 0,
    showFromDays: 0,
    tags: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...over,
  };
}

export function anAttachment(over: Partial<Attachment> = {}): Attachment {
  return {
    id: 300,
    todoId: 100,
    fileName: "notes.pdf",
    contentType: "application/pdf",
    size: 1024,
    createdAt: CREATED,
    ...over,
  };
}

export function aUser(over: Partial<User> = {}): User {
  return {
    id: 1,
    email: "alice@example.com",
    isAdmin: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...over,
  };
}
