const MINOR_UNIT_SCALE = 100;

export function moneyInputToMinor(value: string) {
  const [whole, fraction = ""] = value.trim().split(".");
  const paddedFraction = `${fraction}00`.slice(0, 2);

  return Number(whole) * MINOR_UNIT_SCALE + Number(paddedFraction);
}

export function formatMinorMoney(value: number, currencyCode: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / MINOR_UNIT_SCALE);
}

