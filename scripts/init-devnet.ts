import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { HelloWorld } from "../target/types/hello_world";
import {
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  getCompDefAccOffset,
  getMXEAccAddress,
  getLookupTableAddress,
  uploadCircuit,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

const RPC_URL =
  "https://devnet.helius-rpc.com/?api-key=8c79234f-3452-457b-96e3-171b70c0cfd4";
const PROGRAM_ID = new PublicKey(
  "BLWDVVEBz3X4mcLB8aCBGWjP5zHNPDTKDC7sCVkYwsDk"
);

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const keypairFile = fs.readFileSync(
    `${os.homedir()}/.config/solana/id.json`
  );
  const owner = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(keypairFile.toString()))
  );

  const wallet = {
    publicKey: owner.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(owner);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      txs.forEach((tx) => tx.partialSign(owner));
      return txs;
    },
  };

  const provider = new anchor.AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync("target/idl/hello_world.json", "utf-8")
  );
  const program = new Program<HelloWorld>(idl, provider);
  const arciumProgram = getArciumProgram(provider);

  const circuits = ["add_together", "subtract", "multiply"] as const;
  const initMethods = {
    add_together: "initAddTogetherCompDef",
    subtract: "initSubtractCompDef",
    multiply: "initMultiplyCompDef",
  } as const;

  for (const circuitName of circuits) {
    console.log(`\n--- Initializing ${circuitName} ---`);

    const baseSeed = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset(circuitName);
    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeed, PROGRAM_ID.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    console.log("Comp def PDA:", compDefPDA.toBase58());

    const mxeAccount = getMXEAccAddress(PROGRAM_ID);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      PROGRAM_ID,
      mxeAcc.lutOffsetSlot
    );

    const methodName = initMethods[circuitName];

    try {
      const sig = await (program.methods as any)
        [methodName]()
        .accounts({
          compDefAccount: compDefPDA,
          payer: owner.publicKey,
          mxeAccount,
          addressLookupTable: lutAddress,
        })
        .signers([owner])
        .rpc({ commitment: "confirmed" });

      console.log(`Init tx: ${sig}`);
      console.log(
        `Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`
      );
    } catch (err: any) {
      if (err.message?.includes("already in use")) {
        console.log(`${circuitName} comp def already initialized, skipping.`);
      } else {
        throw err;
      }
    }

    console.log(`Uploading circuit: build/${circuitName}.arcis`);
    const rawCircuit = fs.readFileSync(`build/${circuitName}.arcis`);
    await uploadCircuit(
      provider,
      circuitName,
      PROGRAM_ID,
      rawCircuit,
      true,
      500,
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );
    console.log(`${circuitName} circuit uploaded.`);
  }

  console.log("\n=== All comp defs initialized and circuits uploaded ===");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
