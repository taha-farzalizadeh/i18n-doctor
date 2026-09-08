import { describe, expect, it } from "vitest";
import { createUsageDetector } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("namespace-aware usage resolution (Phase 013.5)", () => {
  it("resolves useTranslation namespace onto t()", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Home.tsx": `
import { useTranslation } from 'react-i18next';
export function Home() {
  const { t } = useTranslation('home');
  return t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("home");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("supports useTranslation multiple namespaces", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { t } = useTranslation(['home', 'settings']);
  return t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("home");
    expect(u?.namespaces).toEqual(["home", "settings"]);
  });

  it("resolves t(key, { ns }) over binding namespace", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { t } = useTranslation('home');
  return t('SAVE', { ns: 'settings' });
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("settings");
    expect(u?.evidence).toContain("options");
  });

  it("resolves const api = useTranslation(ns); api.t()", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const api = useTranslation('home');
  return api.t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "SAVE");
    expect(u?.namespace).toBe("home");
  });

  it("marks unresolved namespaces with low confidence", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/boot.ts": `
import i18n from 'i18next';
i18n.t('orphan');
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
      minConfidence: 0.3,
    });
    const u = catalog.usages.find((x) => x.key === "orphan");
    expect(u?.namespaceResolved).toBe(false);
    expect(u?.confidence).toBeLessThanOrEqual(0.4);
  });

  it("binds tx alias from useTranslation destructuring", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { tx } = useTranslation('home');
  return tx('LABEL');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "LABEL");
    expect(u?.namespace).toBe("home");
  });

  it("applies keyPrefix from useTranslation options", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page() {
  const { t } = useTranslation('home', { keyPrefix: 'form' });
  return t('SAVE');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "form.SAVE");
    expect(u?.namespace).toBe("home");
    expect(u?.evidence).toContain("keyPrefix=form");
  });

  it("applies keyPrefix for next-intl useTranslations", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "next-intl": "3.0.0" },
      }),
      "src/Page.tsx": `
import { useTranslations } from 'next-intl';
export function Page() {
  const t = useTranslations('HomePage', { keyPrefix: 'hero' });
  return t('title');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "hero.title");
    expect(u?.namespace).toBe("HomePage");
  });

  it("resolves namespace for t() inside usersColumns(t) factory", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/utils.ts": `
import type { TFunction } from 'i18next';
type ColDef = { headerName: string; field: string };
export const usersColumns: (t: TFunction) => ColDef[] = t => [
  { headerName: t("USER_NAME"), field: "username" },
  { headerName: t("NAME"), field: "firstName" },
  { headerName: t("LAST_NAME"), field: "lastName" },
];
`,
      "src/UsersTable.tsx": `
import { useTranslation } from 'react-i18next';
import { usersColumns } from './utils';
export function UsersTable() {
  const { t } = useTranslation('usersManagement');
  const columnDefs = [...usersColumns(t)];
  return null;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const keys = catalog.usages.filter((u) =>
      ["USER_NAME", "NAME", "LAST_NAME"].includes(u.key),
    );
    expect(keys).toHaveLength(3);
    for (const u of keys) {
      expect(u.namespace).toBe("usersManagement");
      expect(u.namespaceResolved).toBe(true);
    }
  });

  it("resolves namespace for typed (t: TFunction) arrow factory", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/cols.ts": `
import type { TFunction } from 'i18next';
export const usersColumns = (t: TFunction) => [
  { headerName: t("USER_NAME") },
];
`,
      "src/Table.tsx": `
import { useTranslation } from 'react-i18next';
import { usersColumns } from './cols';
export function Table() {
  const { t } = useTranslation('usersManagement');
  return usersColumns(t);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "USER_NAME");
    expect(u?.namespace).toBe("usersManagement");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("resolves useTranslation(ref || 'settings') fallback namespace", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0" },
      }),
      "src/Form.tsx": `
import { useTranslation } from 'react-i18next';
export function Form(translateReference?: string) {
  const { t } = useTranslation(translateReference || 'settings');
  return t('ENTER_PERSIAN_NAME');
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "ENTER_PERSIAN_NAME");
    expect(u?.namespace).toBe("settings");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("resolves validation(t) namespace via useTranslation(ref || 'settings')", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/validation.ts": `
import type { TFunction } from 'i18next';
export const validation = (t: TFunction) => ({
  name: t("ENTER_PERSIAN_NAME"),
  max: t("255_CHAR"),
});
`,
      "src/Form.tsx": `
import { useTranslation } from 'react-i18next';
import { validation } from './validation';
export function Form(translateReference?: string) {
  const { t } = useTranslation(translateReference || 'settings');
  return validation(t);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    for (const key of ["ENTER_PERSIAN_NAME", "255_CHAR"]) {
      const u = catalog.usages.find((x) => x.key === key);
      expect(u?.namespace).toBe("settings");
      expect(u?.namespaceResolved).toBe(true);
    }
  });

  it("resolves path-alias imports for translator callables", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "app/*": ["./src/app/*"] },
        },
      }),
      "src/app/pages/wp/utils.ts": `
import type { TFunction } from 'i18next';
export const checkRepetitiveWpName = (name: string, t: TFunction) => {
  return t("REPETITIVE_WP_NAME");
};
`,
      "src/app/pages/wp/Drawer.tsx": `
import { useTranslation } from 'react-i18next';
import { checkRepetitiveWpName } from 'app/pages/wp/utils';
export function Drawer() {
  const { t } = useTranslation('work-profile');
  checkRepetitiveWpName('x', t);
  return null;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "REPETITIVE_WP_NAME");
    expect(u?.namespace).toBe("work-profile");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("resolves store/object method translator params (odsDownload)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/actions.ts": `
import type { TFunction } from 'i18next';
export const odsActions = () => ({
  odsDownload: async (uuid: string, t: TFunction) => {
    return t("DOWNLOAD_URL_NOT_FOUND");
  },
});
`,
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
export function Page(odsDownload: (uuid: string, t: any) => Promise<string>) {
  const { t } = useTranslation('etl');
  void odsDownload('1', t);
  return null;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "DOWNLOAD_URL_NOT_FOUND");
    expect(u?.namespace).toBe("etl");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("resolves renamed store selector deleteRowRawById → deleteRawRowById", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/actions.ts": `
import type { TFunction } from 'i18next';
export const odsActions = () => ({
  deleteRawRowById: async (rowId: string, t: TFunction) => {
    return t("ERROR_REMOVE_FILE");
  },
});
`,
      "src/Store.tsx": `
import { odsActions } from './actions';
const actions = odsActions();
export function useEtlStore(selector: (s: typeof actions) => any) {
  return selector(actions);
}
`,
      "src/Page.tsx": `
import { useTranslation } from 'react-i18next';
import { useEtlStore } from './Store';
export function Page() {
  const { t } = useTranslation('etl');
  const deleteRowRawById = useEtlStore(state => state.deleteRawRowById);
  void deleteRowRawById('1', t);
  return null;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "ERROR_REMOVE_FILE");
    expect(u?.namespace).toBe("etl");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("resolves renamed store selector passed as a prop", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/actions.ts": `
import type { TFunction } from 'i18next';
export const odsActions = () => ({
  deleteRawRowById: async (rowId: string, t: TFunction) => {
    return t("ERROR_REMOVE_FILE");
  },
});
`,
      "src/Parent.tsx": `
import { useEtlStore } from './store-shim';
export function Parent() {
  const deleteRowRawById = useEtlStore(state => state.deleteRawRowById);
  return <Child deleteRowRawById={deleteRowRawById} />;
}
`,
      "src/store-shim.ts": `
export function useEtlStore(selector: (s: any) => any) {
  return selector({ deleteRawRowById: async () => {} });
}
`,
      "src/Child.tsx": `
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
export function Child({
  deleteRowRawById,
}: {
  deleteRowRawById: (id: string, t: TFunction) => Promise<void>;
}) {
  const { t } = useTranslation('etl');
  void deleteRowRawById('1', t);
  return null;
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "ERROR_REMOVE_FILE");
    expect(u?.namespace).toBe("etl");
    expect(u?.namespaceResolved).toBe(true);
  });

  it("propagates namespace into nested schema(t) → dateSchema(t)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { "react-i18next": "14.0.0", i18next: "23.0.0" },
      }),
      "src/validation.ts": `
import type { TFunction } from 'i18next';
const dateSchema = (t: TFunction) => ({
  message: t("MONTH_RANGE"),
});
export const schema = (t: TFunction) => ({
  start: dateSchema(t),
  other: t("NON_NEGATIVE_NUMBER"),
});
`,
      "src/Form.tsx": `
import { useTranslation } from 'react-i18next';
import { schema } from './validation';
export function Form() {
  const { t } = useTranslation('datasets');
  return schema(t);
}
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const month = catalog.usages.find((x) => x.key === "MONTH_RANGE");
    expect(month?.namespace).toBe("datasets");
    expect(month?.namespaceResolved).toBe(true);
  });

  it("resolves i18n.t('ns:key') from project i18n wrapper imports", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        dependencies: { i18next: "23.0.0" },
      }),
      "src/i18n/i18n.ts": `
import i18next from 'i18next';
export default i18next;
`,
      "src/Tabs.tsx": `
import i18n from './i18n/i18n';
export const tabs = [
  { label: i18n.t("conditions:ADD_WORD_TAB") },
];
`,
    });
    const catalog = await createUsageDetector().detect({
      root,
      useDetection: false,
    });
    const u = catalog.usages.find((x) => x.key === "ADD_WORD_TAB");
    expect(u?.namespace).toBe("conditions");
    expect(u?.namespaceResolved).toBe(true);
  });
});
