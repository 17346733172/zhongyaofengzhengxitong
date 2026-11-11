import assert from "node:assert/strict";
import test from "node:test";
import { formatBeijingDateTime } from "../src/domain/labels.js";

test("实际录入时间固定显示北京时间，正确跨日", () => {
  assert.equal(formatBeijingDateTime("2026-11-10T06:20:30+00:00"), "2026-11-10 14:20:30");
  assert.equal(formatBeijingDateTime("2026-11-10T16:00:00Z"), "2026-11-11 00:00:00");
  assert.equal(formatBeijingDateTime("2026-11-10T14:20:30+08:00"), "2026-11-10 14:20:30");
});

test("缺少真实时间时显示占位，不把仿真秒数或无时区值当作录入时间", () => {
  for (const value of [null, undefined, "", 402692, "402692", "invalid", "2026-11-10T06:20:30"]) {
    assert.equal(formatBeijingDateTime(value), "—");
  }
});
