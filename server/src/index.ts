import express from "express";
import cors from "cors";
import { ArciumClient, Operation } from "./arcium-client";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let client: ArciumClient;

async function initClient() {
  console.log("Initializing Arcium client...");
  client = new ArciumClient();
  await client.initAllCompDefs();
  console.log("Arcium client ready. Comp defs initialized.");
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", compDefsInitialized: true });
});

// POST /api/init - Re-initialize comp defs (admin only)
app.post("/api/init", async (_req, res) => {
  try {
    await client.initAllCompDefs();
    res.json({ status: "ok", message: "All computation definitions initialized" });
  } catch (error: any) {
    console.error("Init error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/compute - Server-side compute (uses server keypair as payer)
// Use this for backend testing. The frontend uses the wallet adapter directly.
app.post("/api/compute", async (req, res) => {
  try {
    const { operation, a, b } = req.body;

    if (!operation || a === undefined || b === undefined) {
      res.status(400).json({ error: "Missing fields: operation, a, b" });
      return;
    }

    const validOps: Operation[] = ["add", "subtract", "multiply"];
    if (!validOps.includes(operation)) {
      res.status(400).json({
        error: `Invalid operation: ${operation}. Must be one of: ${validOps.join(", ")}`,
      });
      return;
    }

    const result = await client.compute(
      operation as Operation,
      BigInt(a),
      BigInt(b)
    );

    res.json(result);
  } catch (error: any) {
    console.error("Compute error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Convenience shortcuts (server-side compute for testing)
app.post("/api/add", async (req, res) => {
  try {
    const { a, b } = req.body;
    if (a === undefined || b === undefined) {
      res.status(400).json({ error: "Missing fields: a, b" });
      return;
    }
    const result = await client.compute("add", BigInt(a), BigInt(b));
    res.json(result);
  } catch (error: any) {
    console.error("Add error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/subtract", async (req, res) => {
  try {
    const { a, b } = req.body;
    if (a === undefined || b === undefined) {
      res.status(400).json({ error: "Missing fields: a, b" });
      return;
    }
    const result = await client.compute("subtract", BigInt(a), BigInt(b));
    res.json(result);
  } catch (error: any) {
    console.error("Subtract error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/multiply", async (req, res) => {
  try {
    const { a, b } = req.body;
    if (a === undefined || b === undefined) {
      res.status(400).json({ error: "Missing fields: a, b" });
      return;
    }
    const result = await client.compute("multiply", BigInt(a), BigInt(b));
    res.json(result);
  } catch (error: any) {
    console.error("Multiply error:", error);
    res.status(500).json({ error: error.message });
  }
});

initClient()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log("");
      console.log("Admin endpoints (server keypair):");
      console.log("  POST /api/init       - Re-initialize comp defs");
      console.log("  GET  /api/health     - Health check");
      console.log("");
      console.log("Compute endpoints (server keypair as payer - for testing):");
      console.log("  POST /api/compute    { operation, a, b }");
      console.log("  POST /api/add        { a, b }");
      console.log("  POST /api/subtract   { a, b }");
      console.log("  POST /api/multiply   { a, b }");
      console.log("");
      console.log("NOTE: The frontend uses the connected wallet as payer directly.");
    });
  })
  .catch((err) => {
    console.error("Failed to initialize:", err);
    process.exit(1);
  });
