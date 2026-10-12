"use client";

import type { Theme } from "@dripsign/core/schema";
import type { SessionView } from "@dripsign/core/types";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { selectTenant, signOut } from "@/server/actions/auth.ts";
import { setTheme } from "@/server/actions/theme.ts";
import { Avatar, Check, LogOut, Menu, User, Users } from "@/ui";
import styles from "./AccountMenu.module.css";
import { currentHref, type NavLink } from "./navLinks.ts";
import { settle } from "./settle.ts";
import type { Home } from "./standing.ts";

type AccountMenuProps = Readonly<{
  email: string;
  /** Who and where the viewer is ("Staff · Northwind"), shown inside the menu only. */
  roleLabel: string;
  /** The top bar's places; listed here too, but only below 640 px where the bar hides them. */
  links: readonly NavLink[];
  home: Home;
  /** Staff and recipient standing together: only then are both homes listed. */
  bothHomes: boolean;
  tenants: SessionView["staffTenants"];
  selectedTenantId: string | null;
  /** The saved choice, or `system` when the device decides. */
  theme: ThemeChoice;
}>;

type ThemeChoice = Theme | "system";

type ItemId =
  | "home:staff"
  | "home:recipient"
  | "signout"
  | `tenant:${string}`
  | `link:${string}`
  | `theme:${ThemeChoice}`;

type Item = Readonly<{
  id: ItemId;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  narrowOnly?: boolean;
  group?: string;
}>;

const TENANT_PREFIX = "tenant:";
const LINK_PREFIX = "link:";
const THEME_PREFIX = "theme:";

const THEMES: readonly Readonly<{ choice: ThemeChoice; label: string }>[] = [
  { choice: "system", label: "System" },
  { choice: "light", label: "Light" },
  { choice: "dark", label: "Dark" },
  { choice: "night", label: "Night" },
];

/** The four themes first, the chosen one checked and disabled like the tenant switcher's. */
function themeItems(theme: ThemeChoice): Item[] {
  return THEMES.map(({ choice, label }) => ({
    id: `${THEME_PREFIX}${choice}`,
    label,
    group: "Theme",
    disabled: choice === theme,
    ...(choice === theme ? { icon: <Check /> } : {}),
  }));
}

function menuItems(
  { home, bothHomes, links, tenants, selectedTenantId, theme }: AccountMenuProps,
  pathname: string,
): Item[] {
  const current = currentHref(links, pathname);
  const places: Item[] = links.map((link) => ({
    id: `${LINK_PREFIX}${link.href}`,
    label: link.label,
    narrowOnly: true,
    disabled: link.href === current,
  }));
  const homes: Item[] = bothHomes
    ? [
        { id: "home:staff", label: "Staff workspace", icon: <Users />, disabled: home === "staff" },
        {
          id: "home:recipient",
          label: "Shared with me",
          icon: <User />,
          disabled: home === "recipient",
        },
      ]
    : [];
  const switcher: Item[] =
    tenants.length > 1
      ? tenants.map((tenant) => {
          const selected = tenant.id === selectedTenantId;
          return {
            id: `${TENANT_PREFIX}${tenant.id}`,
            label: tenant.name,
            disabled: selected,
            ...(selected ? { icon: <Check /> } : {}),
          };
        })
      : [];
  return [
    ...themeItems(theme),
    ...places,
    ...homes,
    ...switcher,
    { id: "signout", label: "Sign out", icon: <LogOut /> },
  ];
}

/** The server action behind an item that is not a navigation. */
function commandFor(id: ItemId) {
  const chosen = THEMES.find(({ choice }) => id === `${THEME_PREFIX}${choice}`)?.choice;
  if (chosen !== undefined) return setTheme({ theme: chosen });
  if (id.startsWith(TENANT_PREFIX))
    return selectTenant({ tenantId: id.slice(TENANT_PREFIX.length) });
  return signOut();
}

/** The account's popover: the theme, the other home, the tenants to switch between, and sign out. */
export function AccountMenu(props: AccountMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [failure, setFailure] = useState<string | null>(null);

  async function run(id: ItemId) {
    setFailure(null);
    if (id.startsWith(LINK_PREFIX)) {
      router.push(id.slice(LINK_PREFIX.length));
      return;
    }
    if (id === "home:staff" || id === "home:recipient") {
      router.push(id === "home:staff" ? "/staff" : "/");
      return;
    }
    const result = await settle<unknown>(commandFor(id));
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    if (id === "signout") router.replace("/sign-in");
    router.refresh();
  }

  return (
    <>
      <Menu<ItemId>
        label="Account menu"
        icon={<Avatar name={props.email} />}
        caption={
          <>
            <span>{props.email}</span>
            <span>{props.roleLabel}</span>
          </>
        }
        items={menuItems(props, pathname)}
        onAction={(id) => {
          void run(id);
        }}
      />
      {failure !== null && (
        <span role="alert" className={styles.failure}>
          {failure}
        </span>
      )}
    </>
  );
}
