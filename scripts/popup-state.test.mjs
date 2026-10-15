import assert from "node:assert/strict";
import { test } from "node:test";
import { usePopupStore } from "../src/store/popupStore.ts";

test("late translations cannot overwrite a newer selection, error, or closed popup", async () => {
  const store = usePopupStore.getState;
  store().reset();
  store().setClipboardText("A");
  const first = store().beginTranslation();
  let resolveOld;
  const oldResult = new Promise((resolve) => { resolveOld = resolve; }).then(() => {
    store().finishTranslation(first, "old result", null);
  });
  store().setClipboardText("B");
  const second = store().beginTranslation();
  store().finishTranslation(first, "stale result while loading", null);
  assert.equal(store().isTranslating, true);
  store().finishTranslation(second, "new result", null);
  resolveOld();
  await oldResult;
  assert.equal(store().translatedText, "new result");
  store().finishTranslation(first, "", "late error");
  assert.equal(store().error, null);
  const repeated = store().beginTranslation();
  store().setClipboardText("B");
  store().finishTranslation(repeated, "same text, old request", null);
  assert.equal(store().translatedText, "");
  const closed = store().beginTranslation();
  store().reset();
  store().finishTranslation(closed, "reopened result", null);
  assert.equal(store().translatedText, "");
  assert.equal(store().isTranslating, false);
  const language = store().beginTranslation();
  store().setTargetLang("en");
  store().finishTranslation(language, "wrong language", null);
  assert.equal(store().translatedText, "");
});
