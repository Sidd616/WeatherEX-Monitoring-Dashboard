import cors from "cors";
import express from "express";
import "./db/db.js"; // opens the DB and ensures schema exists before anything else runs
import { router } from "./routes/index.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", router);

startScheduler();

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`[server] WeatherEX monitoring dashboard API listening on http://localhost:${PORT}`);
});
