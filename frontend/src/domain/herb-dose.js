const numbers = new Intl.NumberFormat("zh-CN", { useGrouping: false, maximumFractionDigits: 6 });

export function herbDose(herb, doses = 1) {
  const piece = herb.unit === "piece";
  const amount = piece ? herb.quantity_per_dose : herb.grams_per_dose;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return "待补充";
  return `${numbers.format(amount * doses)} ${piece ? "片" : "g"}`;
}

export function herbWeight(herb) {
  return herb.grams_per_dose == null ? "待称重" : `${numbers.format(herb.grams_per_dose)} g/剂`;
}
