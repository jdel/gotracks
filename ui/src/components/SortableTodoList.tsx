import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TodoItem } from "@/components/TodoItem";
import type { Todo } from "@/lib/types";

function SortableRow({ todo, showContext }: { todo: Todo; showContext?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
    >
      <TodoItem todo={todo} showContext={showContext} dragHandle={{ ...attributes, ...listeners }} />
    </div>
  );
}

// SortableTodoList renders a drag-reorderable list. The new order is applied
// optimistically, then persisted one request per moved row.
export function SortableTodoList({
  todos,
  showContext,
}: {
  todos: Todo[];
  showContext?: (t: Todo) => string | undefined;
}) {
  const qc = useQueryClient();
  const [items, setItems] = useState(todos);
  const [prevTodos, setPrevTodos] = useState(todos);

  // Keep local order in sync when the server list changes underneath us. Done
  // during render (the React-recommended way to reset state on a prop change)
  // rather than in an effect, which would flash the stale order for a frame.
  if (todos !== prevTodos) {
    setPrevTodos(todos);
    setItems(todos);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((t) => t.id === active.id);
    const newIndex = items.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);

    // Persist positions for the affected span only.
    const [from, to] = oldIndex < newIndex ? [oldIndex, newIndex] : [newIndex, oldIndex];
    await Promise.all(
      reordered
        .slice(from, to + 1)
        .map((t, i) => api.post(`/todos/${t.id}/reorder`, { position: from + i + 1 }))
    );
    void qc.invalidateQueries({ queryKey: ["todos"] });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {items.map((t) => (
            <SortableRow key={t.id} todo={t} showContext={showContext?.(t)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
