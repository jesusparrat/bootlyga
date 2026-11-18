export type Slot =
  | { zone: "search" }
  | { zone: "group"; index: number }
  | { zone: "channel"; index: number }
  | { zone: "add" }
  | { zone: "stage" };

export type FocusCounts = {
  groups: number;
  channels: number;
};

/**
 * Navegación de mando y teclado.
 * Abajo recorre grupos, canales y el formulario. Derecha salta al vídeo.
 * Izquierda vuelve a la lista. El texto de un campo no pasa por aquí.
 */
export function moveFocus(slot: Slot, key: string, counts: FocusCounts): Slot {
  const groups = Math.max(0, counts.groups);
  const channels = Math.max(0, counts.channels);

  if (key === "Home") return { zone: "search" };
  if (key === "End") return { zone: "stage" };

  if (key === "ArrowDown") return moveDown(slot, groups, channels);
  if (key === "ArrowUp") return moveUp(slot, groups, channels);
  if (key === "ArrowRight" && slot.zone !== "stage") return { zone: "stage" };
  if (key === "ArrowLeft" && slot.zone === "stage") {
    return channels > 0 ? { zone: "channel", index: 0 } : { zone: "search" };
  }
  return slot;
}

function moveDown(slot: Slot, groups: number, channels: number): Slot {
  if (slot.zone === "search") {
    if (groups > 0) return { zone: "group", index: 0 };
    if (channels > 0) return { zone: "channel", index: 0 };
    return { zone: "add" };
  }
  if (slot.zone === "group") {
    const next = slot.index + 1;
    if (next < groups) return { zone: "group", index: next };
    if (channels > 0) return { zone: "channel", index: 0 };
    return { zone: "add" };
  }
  if (slot.zone === "channel") {
    const next = slot.index + 1;
    if (next < channels) return { zone: "channel", index: next };
    return { zone: "add" };
  }
  if (slot.zone === "add") return { zone: "stage" };
  return slot;
}

function moveUp(slot: Slot, groups: number, channels: number): Slot {
  if (slot.zone === "stage") return { zone: "add" };
  if (slot.zone === "add") {
    if (channels > 0) return { zone: "channel", index: channels - 1 };
    if (groups > 0) return { zone: "group", index: groups - 1 };
    return { zone: "search" };
  }
  if (slot.zone === "channel") {
    if (slot.index > 0) return { zone: "channel", index: slot.index - 1 };
    if (groups > 0) return { zone: "group", index: groups - 1 };
    return { zone: "search" };
  }
  if (slot.zone === "group") {
    if (slot.index > 0) return { zone: "group", index: slot.index - 1 };
    return { zone: "search" };
  }
  return slot;
}
