"use client";

import {
  Fragment,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type ToggleEvent,
} from "react";
import styles from "./Menu.module.css";

type MenuItemData<I extends string> = Readonly<{
  id: I;
  label: string;
  icon?: ReactNode;
  /** An action that removes or ends something; drawn in the stop tone. */
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Listed only below 640 px, for what a wider screen shows elsewhere (the top bar's links). */
  narrowOnly?: boolean | undefined;
  /** Consecutive items with the same group sit together under that label ("Theme"). */
  group?: string | undefined;
}>;

type MenuProps<I extends string> = Readonly<{
  /** The trigger's accessible name ("More actions"). */
  label: string;
  /** The trigger's glyph. */
  icon: ReactNode;
  variant?: "secondary" | "quiet" | undefined;
  items: readonly MenuItemData<I>[];
  /** Words above the items that are not actions, such as who is signed in. */
  caption?: ReactNode;
  disabled?: boolean | undefined;
  /** Receives one of the item ids, after the menu has closed and focus is back on the trigger. */
  onAction: (id: I) => void;
}>;

/** The popover's wiring: where it sits, what it focuses and the keys it answers. */
function useMenuBehaviour() {
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  function enabledItems(): HTMLButtonElement[] {
    // An item hidden at this width (narrowOnly) has no offsetParent and cannot take focus.
    return Array.from(
      popover.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? [],
    ).filter((item) => item.offsetParent !== null);
  }

  function place() {
    const anchor = trigger.current?.getBoundingClientRect();
    const panel = popover.current;
    if (anchor === undefined || panel === null) return;
    panel.style.setProperty("--menu-x", `${String(anchor.right)}px`);
    panel.style.setProperty("--menu-y", `${String(anchor.bottom)}px`);
    for (const name of ["--menu-tx", "--menu-ty", "--menu-dir"]) panel.style.removeProperty(name);
  }

  // Once the panel has a size: keep it on screen by hanging from the trigger's start edge when
  // its end edge has no room, and rising above the trigger when there is no room below.
  function keepOnScreen(panel: HTMLElement) {
    const anchor = trigger.current?.getBoundingClientRect();
    if (anchor === undefined) return;
    if (anchor.right - panel.offsetWidth < 0) {
      panel.style.setProperty("--menu-x", `${String(anchor.left)}px`);
      panel.style.setProperty("--menu-tx", "0%");
    }
    if (anchor.bottom + panel.offsetHeight > window.innerHeight) {
      panel.style.setProperty("--menu-y", `${String(anchor.top)}px`);
      panel.style.setProperty("--menu-ty", "-100%");
      panel.style.setProperty("--menu-dir", "-1");
    }
  }

  function onToggle(event: ToggleEvent<HTMLDivElement>) {
    const isOpen = event.newState === "open";
    setOpen(isOpen);
    if (!isOpen) return;
    keepOnScreen(event.currentTarget);
    enabledItems()[0]?.focus();
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const all = enabledItems();
    const at = all.findIndex((item) => item === document.activeElement);
    const last = all.length - 1;
    const target: Record<string, number> = {
      ArrowDown: at >= last ? 0 : at + 1,
      ArrowUp: at <= 0 ? last : at - 1,
      Home: 0,
      End: last,
    };
    const next = target[event.key];
    if (next !== undefined) {
      event.preventDefault();
      all[next]?.focus();
    } else if (event.key === "Tab") {
      popover.current?.hidePopover();
    }
  }

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    place();
    if (popover.current?.matches(":popover-open") === true) enabledItems()[0]?.focus();
    else popover.current?.showPopover();
  }

  return { trigger, popover, open, place, onToggle, onMenuKey, onTriggerKey };
}

function MenuRow<I extends string>({
  item,
  onPick,
}: Readonly<{ item: MenuItemData<I>; onPick: (id: I) => void }>) {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      data-tone={item.danger === true ? "stop" : undefined}
      data-narrow-only={item.narrowOnly === true ? "" : undefined}
      disabled={item.disabled === true}
      onClick={() => {
        onPick(item.id);
      }}
    >
      {item.icon !== undefined && (
        <span className={styles.icon} aria-hidden="true">
          {item.icon}
        </span>
      )}
      {item.label}
    </button>
  );
}

/** Consecutive items that share a group label, in order; items without one run together. */
function groupsOf<I extends string>(items: readonly MenuItemData<I>[]) {
  const runs: { label: string | undefined; members: MenuItemData<I>[] }[] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (last !== undefined && last.label === item.group) last.members.push(item);
    else runs.push({ label: item.group, members: [item] });
  }
  return runs;
}

/**
 * A short list of actions behind an icon button. The browser's popover API owns open, Escape,
 * click-outside and focus return; this adds the menu keys: ArrowDown on the trigger opens, the
 * arrows, Home and End move between items, Tab closes. Items are real buttons, so Enter and
 * Space act.
 */
export function Menu<I extends string>({
  label,
  icon,
  variant = "quiet",
  items,
  caption,
  disabled = false,
  onAction,
}: MenuProps<I>) {
  const id = useId();
  const { trigger, popover, open, place, onToggle, onMenuKey, onTriggerKey } = useMenuBehaviour();

  function row(item: MenuItemData<I>) {
    return (
      <MenuRow
        key={item.id}
        item={item}
        onPick={(picked) => {
          popover.current?.hidePopover();
          onAction(picked);
        }}
      />
    );
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        data-variant={variant}
        data-size="md"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        disabled={disabled}
        onClick={place}
        onKeyDown={onTriggerKey}
      >
        {icon}
      </button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        className={styles.popover}
        onToggle={onToggle}
        onKeyDown={onMenuKey}
      >
        {caption !== undefined && (
          <div role="presentation" className={styles.caption}>
            {caption}
          </div>
        )}
        {groupsOf(items).map(({ label, members }) =>
          label === undefined ? (
            <Fragment key={members[0]?.id}>{members.map(row)}</Fragment>
          ) : (
            <div key={label} role="group" aria-label={label} className={styles.group}>
              <span aria-hidden="true" className={styles.groupLabel}>
                {label}
              </span>
              {members.map(row)}
            </div>
          ),
        )}
      </div>
    </>
  );
}
