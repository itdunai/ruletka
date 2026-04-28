export type Prize = {
  id: string;
  title: string;
  type: "discount" | "delivery" | "gift" | "deposit" | "none";
  value: string | null;
  weight: number;
  imageUrl: string | null;
  isActive: boolean;
};

export const DEMO_PRIZES: Prize[] = [
  { id: "p1", title: "Скидка 5%", type: "discount", value: "5", weight: 25, imageUrl: null, isActive: true },
  { id: "p2", title: "Скидка 10%", type: "discount", value: "10", weight: 15, imageUrl: null, isActive: true },
  { id: "p3", title: "Скидка 15%", type: "discount", value: "15", weight: 8, imageUrl: null, isActive: true },
  { id: "p4", title: "Бесплатная доставка", type: "delivery", value: "free", weight: 20, imageUrl: null, isActive: true },
  { id: "p5", title: "Позиция до 800 ₽", type: "gift", value: "800", weight: 7, imageUrl: null, isActive: true },
  { id: "p6", title: "Депозит 500 ₽", type: "deposit", value: "500", weight: 10, imageUrl: null, isActive: true },
  { id: "p7", title: "Депозит 1000 ₽", type: "deposit", value: "1000", weight: 5, imageUrl: null, isActive: true },
  { id: "p8", title: "Депозит 5000 ₽", type: "deposit", value: "5000", weight: 1, imageUrl: null, isActive: true },
  { id: "p9", title: "В другой раз", type: "none", value: null, weight: 9, imageUrl: null, isActive: true }
];

export function getDefaultPrizesWithoutId(): Omit<Prize, "id">[] {
  return DEMO_PRIZES.map(({ id: _id, ...rest }) => rest);
}

export function pickWeightedPrize(prizes: Prize[]): Prize {
  const active = prizes.filter((p) => p.isActive && p.weight > 0);
  const totalWeight = active.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) {
    throw new Error("No active prizes with positive weight");
  }

  let random = Math.random() * totalWeight;
  for (const prize of active) {
    random -= prize.weight;
    if (random <= 0) {
      return prize;
    }
  }

  return active[active.length - 1];
}
