import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN } from "@anchor-lang/core";
import { PublicKey, SendTransactionError } from "@solana/web3.js";
import {
  awaitComputationFinalization,
  getCompDefAccOffset,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  x25519,
} from "@arcium-hq/client";
import { HelloWorld } from "../../target/types/hello_world";
import idl from "../../target/idl/hello_world.json";

export type Operation = "add" | "subtract" | "multiply";

export interface ComputeResult {
  result: string;
  operation: Operation;
  a: string;
  b: string;
  txSignature: string;
  finalizationSignature: string;
}

const PROGRAM_ID = new PublicKey(
  "BLWDVVEBz3X4mcLB8aCBGWjP5zHNPDTKDC7sCVkYwsDk"
);

const CLUSTER_OFFSET = Number(
  import.meta.env.VITE_ARCIUM_CLUSTER_OFFSET || "456"
);

function getRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function getMXEPublicKeyWithRetry(
  provider: AnchorProvider,
  programId: PublicKey,
  maxRetries = 20,
  retryDelayMs = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) return mxePublicKey;
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

export function useArciumCompute() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const compute = useCallback(
    async (operation: Operation, a: bigint, b: bigint): Promise<ComputeResult> => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Wallet not connected");
      }

      const provider = new AnchorProvider(
        connection,
        {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
          signAllTransactions: wallet.signAllTransactions!,
        },
        { commitment: "confirmed" }
      );

      const program = new Program<HelloWorld>(
        idl as any,
        provider
      );

      const circuitName =
        operation === "add" ? "add_together" : operation;
      const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);

      // Get MXE public key and set up encryption
      const mxePublicKey = await getMXEPublicKeyWithRetry(
        provider,
        PROGRAM_ID
      );
      const privateKey = x25519.utils.randomSecretKey();
      const publicKey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);

      // Encrypt inputs
      const plaintext = [a, b];
      const nonce = getRandomBytes(16);
      const ciphertext = cipher.encrypt(plaintext, nonce);

      console.log(`Computing ${operation}(${a}, ${b}) via MXE...`);

      // Set up event listener
      type ProgramEvent = {
        sum?: number[];
        diff?: number[];
        product?: number[];
        nonce: number[];
      };

      const eventName =
        operation === "add"
          ? "sumEvent"
          : operation === "subtract"
            ? "diffEvent"
            : "multiplyEvent";

      let listenerId: number;
      const eventPromise = new Promise<ProgramEvent>((resolve) => {
        listenerId = program.addEventListener(
          eventName as any,
          (event: any) => {
            resolve(event);
          }
        );
      });

      const computationOffset = new BN(
        Buffer.from(getRandomBytes(8))
      );

      // Build and send the transaction
      const methodName =
        operation === "add"
          ? "addTogether"
          : operation === "subtract"
            ? "subtract"
            : "multiply";

      let queueSig: string;
      try {
        queueSig = await (program.methods as any)[methodName](
          computationOffset,
          Array.from(ciphertext[0]),
          Array.from(ciphertext[1]),
          Array.from(publicKey),
          new BN(deserializeLE(nonce).toString())
        )
          .accountsPartial({
            computationAccount: getComputationAccAddress(
              CLUSTER_OFFSET,
              computationOffset
            ),
            clusterAccount,
            mxeAccount: getMXEAccAddress(PROGRAM_ID),
            mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
            executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
            compDefAccount: getCompDefAccAddress(
              PROGRAM_ID,
              Buffer.from(getCompDefAccOffset(circuitName)).readUInt32LE()
            ),
          })
          .rpc({ commitment: "confirmed" });
      } catch (err: any) {
        // Anchor + web3.js version mismatch hides real errors.
        // Try to extract actual transaction logs.
        if (err.logs) {
          console.error("Transaction logs:", err.logs);
          throw new Error(
            `Transaction failed: ${err.logs.filter((l: string) => l.includes("Error") || l.includes("failed")).join("; ") || err.message}`
          );
        }
        if (err instanceof SendTransactionError) {
          const logs = await err.getLogs(connection);
          console.error("Transaction logs:", logs);
          throw new Error(`Transaction failed: ${logs?.join("; ") || err.message}`);
        }
        throw err;
      }

      console.log("Queue tx:", queueSig);

      // Wait for finalization
      const finalizeSig = await awaitComputationFinalization(
        provider,
        computationOffset,
        PROGRAM_ID,
        "confirmed"
      );
      console.log("Finalize tx:", finalizeSig);

      // Get the event and decrypt
      const event = await eventPromise;
      await program.removeEventListener(listenerId!);

      const encryptedResult =
        operation === "add"
          ? event.sum!
          : operation === "subtract"
            ? event.diff!
            : event.product!;
      const resultNonce = event.nonce;

      const decrypted = cipher.decrypt(
        [encryptedResult as any],
        resultNonce as any
      )[0];

      console.log(`Result: ${decrypted}`);

      return {
        result: decrypted.toString(),
        operation,
        a: a.toString(),
        b: b.toString(),
        txSignature: queueSig,
        finalizationSignature: finalizeSig,
      };
    },
    [connection, wallet]
  );

  return { compute, connected: !!wallet.publicKey };
}
