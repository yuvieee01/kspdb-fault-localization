import express from "express";
import cors from "cors";
import telemetryRouter from "./routes/telemetry";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "5mb" })); // allow large batch payloads

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "kspdb-backend" });
});

app.get("/api/hello", (_req, res) => {
  res.json({ message: "KSPDB Fault Localization — backend running" });
});

// Telemetry ingest
app.use("/api/telemetry", telemetryRouter);

app.listen(PORT, () => {
  console.log(`[backend] listening on port ${PORT}`);
});
