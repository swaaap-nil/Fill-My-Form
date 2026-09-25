import type { Page } from "@playwright/test";
import { expect, test } from "./fill-fixtures";
import { grantAccess, openPanel } from "./fill-helpers";

const sentinelStyles = {
  body: [
    "backgroundColor",
    "color",
    "fontFamily",
    "fontSize",
    "lineHeight",
    "marginTop",
  ],
  container: [
    "backgroundColor",
    "borderTopColor",
    "borderTopStyle",
    "borderTopWidth",
    "borderRadius",
    "paddingTop",
    "width",
  ],
  nav: [
    "alignItems",
    "backgroundColor",
    "borderTopColor",
    "borderTopWidth",
    "borderRadius",
    "display",
    "gap",
    "paddingTop",
  ],
  button: [
    "backgroundColor",
    "borderTopColor",
    "borderTopWidth",
    "borderRadius",
    "boxSizing",
    "color",
    "display",
    "fontFamily",
    "height",
    "paddingLeft",
  ],
  input: [
    "backgroundColor",
    "borderTopColor",
    "borderTopWidth",
    "borderRadius",
    "boxSizing",
    "color",
    "fontFamily",
    "height",
    "paddingLeft",
    "width",
  ],
  textarea: [
    "backgroundColor",
    "borderTopColor",
    "borderTopWidth",
    "borderRadius",
    "boxSizing",
    "color",
    "fontFamily",
    "height",
    "paddingLeft",
    "width",
  ],
} as const;

type SentinelName = keyof typeof sentinelStyles;
type StyleSnapshot = Record<SentinelName, Record<string, string>>;

const collectStyleSnapshot = async (page: Page): Promise<StyleSnapshot> =>
  page.evaluate((styleMap) => {
    const readStyles = (target: Element, properties: readonly string[]) => {
      const styles = getComputedStyle(target);
      return Object.fromEntries(
        properties.map((property) => [
          property,
          styles.getPropertyValue(
            property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
          ),
        ]),
      );
    };

    const selectors = {
      body: "body",
      container: '[data-style-sentinel="container"]',
      nav: '[data-style-sentinel="nav"]',
      button: '[data-style-sentinel="button"]',
      input: '[data-style-sentinel="input"]',
      textarea: '[data-style-sentinel="textarea"]',
    } as const;

    return Object.fromEntries(
      Object.entries(styleMap).map(([name, properties]) => {
        const target = document.querySelector(
          selectors[name as keyof typeof selectors],
        );
        if (!target) throw new Error(`Missing style sentinel: ${name}`);
        return [name, readStyles(target, properties)];
      }),
    ) as StyleSnapshot;
  }, sentinelStyles);

test("content script does not change host page computed styles", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/style-isolation.html");

  const before = await collectStyleSnapshot(formPage);

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  await expect(formPage.locator("form-agent-ui")).toHaveCount(1);
  expect(await collectStyleSnapshot(formPage)).toEqual(before);
});
