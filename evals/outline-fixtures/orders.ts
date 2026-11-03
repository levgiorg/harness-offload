import { db } from "./db";

export interface Order {
  id: string;
  total: number;
}

export class OrderService {
  constructor(private repo: Repo) {}

  async place(order: Order): Promise<void> {
    await this.repo.save(order);
  }

  private total(items: number[]): number {
    return items.reduce((a, b) => a + b, 0);
  }
}

export const refund = async (id: string) => {
  return db.refund(id);
};

export function audit(id: string): void {
  console.log(id);
}
