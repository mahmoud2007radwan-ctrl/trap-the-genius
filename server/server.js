import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "matches.json");
const app = express();
const PORT = 3001;

app.use(express.json());
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "[]", "utf8");

app.get("/api/matches", (_req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(dataFile, "utf8")));
  } catch {
    res.status(500).json({ message: "Could not read match history." });
  }
});

app.post("/api/matches", (req, res) => {
  const { mode, player1, player2, winner, moves } = req.body ?? {};
  if (![mode, player1, player2, winner].every(v => typeof v === "string" && v.trim())) {
    return res.status(400).json({ message: "Match details are incomplete." });
  }
  const match = {
    id: Date.now().toString(),
    mode,
    player1: player1.trim().slice(0, 30),
    player2: player2.trim().slice(0, 30),
    winner: winner.trim().slice(0, 30),
    moves: Number.isFinite(moves) ? moves : 0,
    playedAt: new Date().toISOString()
  };
  try {
    const matches = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    matches.unshift(match);
    fs.writeFileSync(dataFile, JSON.stringify(matches.slice(0, 100), null, 2), "utf8");
    res.status(201).json(match);
  } catch {
    res.status(500).json({ message: "Could not save match." });
  }
});

app.listen(PORT, () => console.log(`Match history API running at http://localhost:${PORT}`));