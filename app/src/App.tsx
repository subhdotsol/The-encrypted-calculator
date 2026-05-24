import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useArciumCompute, Operation } from "./useArciumCompute";

export default function App() {
  const [num1, setNum1] = useState("");
  const [num2, setNum2] = useState("");
  const [operation, setOperation] = useState("add");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);

  const { compute, connected } = useArciumCompute();
  const [copied, setCopied] = useState(false);

  const copyTxSig = () => {
    if (!txSig) return;
    navigator.clipboard.writeText(txSig);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const calculate = async () => {
    const a = Number(num1);
    const b = Number(num2);

    if (isNaN(a) || isNaN(b)) {
      setResult("Invalid Input");
      return;
    }

    if (!connected) {
      setResult("Connect wallet first");
      return;
    }

    setLoading(true);
    setResult(null);
    setTxSig(null);

    try {
      const opMap: Record<string, Operation> = {
        add: "add",
        sub: "subtract",
        multiply: "multiply",
      };

      const data = await compute(opMap[operation], BigInt(a), BigInt(b));
      setResult(data.result);
      setTxSig(data.txSignature);
    } catch (err: any) {
      console.error("Compute error:", err);
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const operations = [
    { value: "add", label: "+" },
    { value: "sub", label: "−" },
    { value: "multiply", label: "×" },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 p-6">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
          {/* Header with Wallet Button */}
          <div className="px-6 pt-6 pb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">
                Calculator
              </h1>
              <p className="text-sm text-zinc-500 mt-1">
                Encrypted MXE computation
              </p>
            </div>
            <WalletMultiButton
              style={{
                fontSize: "13px",
                height: "36px",
                borderRadius: "8px",
                padding: "0 12px",
              }}
            />
          </div>

          {/* Inputs */}
          <div className="px-6 space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                First number
              </label>
              <input
                type="number"
                placeholder="0"
                value={num1}
                onChange={(e) => setNum1(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none text-zinc-900 text-base transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                Second number
              </label>
              <input
                type="number"
                placeholder="0"
                value={num2}
                onChange={(e) => setNum2(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200 focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none text-zinc-900 text-base transition-colors"
              />
            </div>

            {/* Operation selector */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">
                Operation
              </label>
              <div className="grid grid-cols-3 gap-2">
                {operations.map((op) => (
                  <button
                    key={op.value}
                    onClick={() => setOperation(op.value)}
                    className={`py-2.5 rounded-lg text-lg font-medium transition-colors ${
                      operation === op.value
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Calculate button */}
          <div className="px-6 pt-5">
            <button
              onClick={calculate}
              disabled={loading || !connected}
              className="w-full py-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 transition-colors text-white font-medium text-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!connected
                ? "Connect Wallet to Calculate"
                : loading
                  ? "Computing on MXE..."
                  : "Calculate"}
            </button>
          </div>

          {/* Result */}
          <div className="mx-6 my-5 p-4 rounded-lg bg-zinc-50 border border-zinc-200">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">
              Result
            </p>
            <p className="text-2xl font-semibold text-zinc-900 break-all">
              {loading ? "..." : result !== null ? result : "—"}
            </p>
            {txSig && (
              <button
                onClick={copyTxSig}
                className="flex items-center gap-1.5 text-xs text-zinc-400 mt-2 hover:text-zinc-600 transition-colors cursor-pointer w-full text-left"
                title={txSig}
              >
                <span className="truncate">tx: {txSig}</span>
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-500">
                  {copied ? "Copied!" : "Copy"}
                </span>
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-zinc-400 mt-4">
          Encrypted computation via Arcium MXE
        </p>
      </div>
    </div>
  );
}
