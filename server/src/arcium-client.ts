import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { HelloWorld } from "../../target/types/hello_world";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

export type Operation = "add" | "subtract" | "multiply";

export interface ComputeResult {
  result: string;
  operation: Operation;
  a: string;
  b: string;
  txSignature: string;
  finalizationSignature: string;
}

type Event = anchor.IdlEvents<(typeof HelloWorld)["prototype"]["idl"]>;

export class ArciumClient {
  private program: Program<HelloWorld>;
  private provider: anchor.AnchorProvider;
  private arciumProgram: ReturnType<typeof getArciumProgram>;
  private arciumEnv: ReturnType<typeof getArciumEnv>;
  private clusterAccount: PublicKey;
  private initialized: {
    add_together: boolean;
    subtract: boolean;
    multiply: boolean;
  } = { add_together: false, subtract: false, multiply: false };

  constructor() {
    anchor.setProvider(anchor.AnchorProvider.env());
    this.program = anchor.workspace.HelloWorld as Program<HelloWorld>;
    this.provider = anchor.getProvider() as anchor.AnchorProvider;
    this.arciumProgram = getArciumProgram(this.provider);
    this.arciumEnv = getArciumEnv();
    this.clusterAccount = getClusterAccAddress(
      this.arciumEnv.arciumClusterOffset
    );
  }

  private readOwnerKeypair(): anchor.web3.Keypair {
    const file = fs.readFileSync(
      `${os.homedir()}/.config/solana/id.json`
    );
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(file.toString()))
    );
  }

  private async getMXEPublicKeyWithRetry(
    maxRetries = 20,
    retryDelayMs = 500
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const mxePublicKey = await getMXEPublicKey(
          this.provider,
          this.program.programId
        );
        if (mxePublicKey) return mxePublicKey;
      } catch (error) {
        console.log(
          `Attempt ${attempt} failed to fetch MXE public key:`,
          error
        );
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    throw new Error(
      `Failed to fetch MXE public key after ${maxRetries} attempts`
    );
  }

  private awaitEvent<E extends keyof Event>(eventName: E): Promise<Event[E]> {
    let listenerId: number;
    const eventPromise = new Promise<Event[E]>((res) => {
      listenerId = this.program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    return eventPromise.then(async (event) => {
      await this.program.removeEventListener(listenerId!);
      return event;
    });
  }

  // --- Comp def initialization helpers ---

  private async initCompDef(
    circuitName: "add_together" | "subtract" | "multiply"
  ): Promise<string> {
    if (this.initialized[circuitName]) {
      console.log(`${circuitName} comp def already initialized, skipping`);
      return "already-initialized";
    }

    const owner = this.readOwnerKeypair();
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset(circuitName);

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, this.program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    const mxeAccount = getMXEAccAddress(this.program.programId);
    const mxeAcc =
      await this.arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      this.program.programId,
      mxeAcc.lutOffsetSlot
    );

    // Call the appropriate init method
    const initMethod =
      circuitName === "add_together"
        ? this.program.methods.initAddTogetherCompDef()
        : circuitName === "subtract"
          ? this.program.methods.initSubtractCompDef()
          : this.program.methods.initMultiplyCompDef();

    const sig = await initMethod
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log(`Init ${circuitName} comp def tx:`, sig);

    const rawCircuit = fs.readFileSync(`build/${circuitName}.arcis`);
    await uploadCircuit(
      this.provider,
      circuitName,
      this.program.programId,
      rawCircuit,
      true,
      500,
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );

    this.initialized[circuitName] = true;
    return sig;
  }

  async initAllCompDefs(): Promise<void> {
    console.log("Initializing all computation definitions...");
    await this.initCompDef("add_together");
    await this.initCompDef("subtract");
    await this.initCompDef("multiply");
    console.log("All computation definitions initialized.");
  }

  async initCompDefFor(operation: Operation): Promise<void> {
    const circuitName =
      operation === "add" ? "add_together" : operation;
    await this.initCompDef(
      circuitName as "add_together" | "subtract" | "multiply"
    );
  }

  // --- Core compute method ---

  async compute(
    operation: Operation,
    a: bigint,
    b: bigint
  ): Promise<ComputeResult> {
    const circuitName =
      operation === "add" ? "add_together" : operation;

    // Ensure comp def is initialized
    await this.initCompDefFor(operation);

    // Get MXE public key and set up encryption
    const mxePublicKey = await this.getMXEPublicKeyWithRetry();
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Encrypt inputs
    const plaintext = [a, b];
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    console.log(`Computing ${operation}(${a}, ${b})...`);

    // Set up event listener based on operation
    const eventName =
      operation === "add"
        ? "sumEvent"
        : operation === "subtract"
          ? "diffEvent"
          : "multiplyEvent";

    const eventPromise = this.awaitEvent(eventName as keyof Event);
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Build and send the transaction
    const methodFn =
      operation === "add"
        ? this.program.methods.addTogether
        : operation === "subtract"
          ? this.program.methods.subtract
          : this.program.methods.multiply;

    const queueSig = await methodFn
      .call(
        this.program.methods,
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          this.arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount: this.clusterAccount,
        mxeAccount: getMXEAccAddress(this.program.programId),
        mempoolAccount: getMempoolAccAddress(
          this.arciumEnv.arciumClusterOffset
        ),
        executingPool: getExecutingPoolAccAddress(
          this.arciumEnv.arciumClusterOffset
        ),
        compDefAccount: getCompDefAccAddress(
          this.program.programId,
          Buffer.from(getCompDefAccOffset(circuitName)).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    console.log("Queue tx:", queueSig);

    // Wait for finalization
    const finalizeSig = await awaitComputationFinalization(
      this.provider,
      computationOffset,
      this.program.programId,
      "confirmed"
    );
    console.log("Finalize tx:", finalizeSig);

    // Get the event and decrypt
    const event = await eventPromise;
    const encryptedResult =
      operation === "add"
        ? (event as any).sum
        : operation === "subtract"
          ? (event as any).diff
          : (event as any).product;
    const resultNonce = (event as any).nonce;

    const decrypted = cipher.decrypt([encryptedResult], resultNonce)[0];
    console.log(`Result: ${decrypted}`);

    return {
      result: decrypted.toString(),
      operation,
      a: a.toString(),
      b: b.toString(),
      txSignature: queueSig,
      finalizationSignature: finalizeSig,
    };
  }
}
