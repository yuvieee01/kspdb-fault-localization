import { Router, Request, Response } from "express";
import { runLocalization } from "../localization/engine";

const router = Router();

/** Manual localization trigger for deterministic testing and operations. */
router.post("/run", async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await runLocalization();
    res.status(result.skipped ? 409 : 200).json(result);
  } catch (error) {
    console.error("[localization] Run failed:", error);
    res.status(500).json({ error: "localization run failed" });
  }
});

export default router;
