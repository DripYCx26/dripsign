"use client";

import {
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
}>;

type MenuProps<I extends string> = Readonly<{
  /** The trigger's accessible name ("More actions"). */
  label: string;
  /** The trigger's glyph. */
  icon: ReactNode;
  variant?: "secondary" | "quiet" | undefined;
  items: readonly MenuItemData<I>[];
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
    return Array.from(popover.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? []);
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
  disabled = false,
  onAction,
}: MenuProps<I>) {
  const id = useId();
  const { trigger, popover, open, place, onToggle, onMenuKey, onTriggerKey } = useMenuBehaviour();

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
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={styles.item}
            data-tone={item.danger === true ? "stop" : undefined}
            disabled={item.disabled === true}
            onClick={() => {
              popover.current?.hidePopover();
              onAction(item.id);
            }}
          >
            {item.icon !== undefined && (
              <span className={styles.icon} aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
