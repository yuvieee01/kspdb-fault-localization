import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "kspdb-backend" });
});

app.get("/api/hello", (_req, res) => {
  res.json({ message: "KSPDB Fault Localization — backend running" });
});

app.listen(PORT, () => {
  console.log(`[backend] listening on port ${PORT}`);
});
