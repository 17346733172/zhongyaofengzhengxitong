import assert from "node:assert/strict";
import test from "node:test";
import { herbDose, herbWeight } from "../src/domain/herb-dose.js";

test("计数饮片按片显示每剂和多剂合计，未称重时不显示克数", () => {
  const herb = { unit: "piece", quantity_per_dose: 3, grams_per_dose: null };
  assert.equal(herbDose(herb), "3 片");
  assert.equal(herbDose(herb, 5), "15 片");
  assert.equal(herbWeight(herb), "待称重");
  assert.equal(herbDose({ ...herb, quantity_per_dose: 0.5 }, 3), "1.5 片");
});

test("补称重后原片数仍保留，旧版克数处方保持兼容", () => {
  const herb = { unit: "piece", quantity_per_dose: 3, grams_per_dose: 4.5 };
  assert.equal(herbDose(herb), "3 片");
  assert.equal(herbWeight(herb), "4.5 g/剂");
  assert.equal(herbDose({ grams_per_dose: 9 }, 5), "45 g");
  assert.equal(herbDose({}), "待补充");
});
