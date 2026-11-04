import { createDatabase, IDatabase } from "@aso/database";

export class TaskWorker {
  constructor(private db: IDatabase) {}

  public async start(): Promise<void> {
    console.log("[ASO Worker] Background task worker initialized and ready.");
  }
}

if (process.env.NODE_ENV !== "test") {
  const db = createDatabase();
  const worker = new TaskWorker(db);
  worker.start();
}

