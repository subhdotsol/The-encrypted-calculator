import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { HelloWorld } from "../target/types/hello_world";
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
import { expect } from "chai";

describe("HelloWorld", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.HelloWorld as Program<HelloWorld>;
  const provider = anchor.getProvider();
  const arciumProgram = getArciumProgram(provider as anchor.AnchorProvider);

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);

    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("Is initialized!", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Initializing add together computation definition");
    const initATSig = await initAddTogetherCompDef(program, owner);
    console.log(
      "Add together computation definition initialized with signature",
      initATSig
    );

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    console.log("MXE x25519 pubkey is", mxePublicKey);

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);

    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // const val1 = BigInt(1);
    // const val2 = BigInt(2);
    // const plaintext = [val1, val2];

    // const nonce = randomBytes(16);
    // const ciphertext = cipher.encrypt(plaintext, nonce);

    const val1 = BigInt(60);
    const val2 = BigInt(9);

    console.log("\n========== PLAINTEXT INPUTS ==========");
    console.log("a =", val1.toString());
    console.log("b =", val2.toString());

    const plaintext = [val1, val2];

    console.log("\nPlaintext array:");
    console.log(plaintext.map((v) => v.toString()));

    const nonce = randomBytes(16);

    console.log("\n========== NONCE ==========");
    console.log("nonce (hex) =", Buffer.from(nonce).toString("hex"));

    const ciphertext = cipher.encrypt(plaintext, nonce);

    console.log("\n========== ENCRYPTED VALUES ==========");

    console.log("enc(a) raw bytes =", ciphertext[0]);

    console.log("enc(a) hex =", Buffer.from(ciphertext[0]).toString("hex"));

    console.log("enc(b) raw bytes =", ciphertext[1]);

    console.log("enc(b) hex =", Buffer.from(ciphertext[1]).toString("hex"));

    console.log("\n========== ENCRYPTION SUMMARY ==========");
    console.log("60 -> enc(a)");
    console.log("9  -> enc(b)");

    const sumEventPromise = awaitEvent("sumEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueSig = await program.methods
      .addTogether(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("add_together")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Queue sig is ", queueSig);

    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Finalize sig is ", finalizeSig);

    const sumEvent = await sumEventPromise;

    console.log("\n========== EVENT RECEIVED ==========");

    console.log("encrypted result raw =", sumEvent.sum);

    console.log(
      "encrypted result hex =",
      Buffer.from(sumEvent.sum).toString("hex")
    );

    console.log(
      "result nonce hex =",
      Buffer.from(sumEvent.nonce).toString("hex")
    );

    // const decrypted = cipher.decrypt([sumEvent.sum], sumEvent.nonce)[0];
    // expect(decrypted).to.equal(val1 + val2);

    console.log("\n========== DECRYPTING RESULT ==========");

    const decrypted = cipher.decrypt([sumEvent.sum], sumEvent.nonce)[0];

    console.log("final decrypted result =", decrypted.toString());

    console.log("\n========== EXPECTED ==========");
    console.log(
      `${val1.toString()} + ${val2.toString()} = ${(val1 + val2).toString()}`
    );

    expect(decrypted).to.equal(val1 + val2);

    console.log("\n========== TEST PASSED ==========");
  });

  it("Subtract works!", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Initializing subtract computation definition");
    const initSubSig = await initSubtractCompDef(program, owner);
    console.log(
      "Subtract computation definition initialized with signature",
      initSubSig
    );

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    console.log("MXE x25519 pubkey is", mxePublicKey);

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);

    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const val1 = BigInt(60);
    const val2 = BigInt(9);

    console.log("\n========== PLAINTEXT INPUTS ==========");
    console.log("a =", val1.toString());
    console.log("b =", val2.toString());

    const plaintext = [val1, val2];

    console.log("\nPlaintext array:");
    console.log(plaintext.map((v) => v.toString()));

    const nonce = randomBytes(16);

    console.log("\n========== NONCE ==========");
    console.log("nonce (hex) =", Buffer.from(nonce).toString("hex"));

    const ciphertext = cipher.encrypt(plaintext, nonce);

    console.log("\n========== ENCRYPTED VALUES ==========");

    console.log("enc(a) raw bytes =", ciphertext[0]);

    console.log("enc(a) hex =", Buffer.from(ciphertext[0]).toString("hex"));

    console.log("enc(b) raw bytes =", ciphertext[1]);

    console.log("enc(b) hex =", Buffer.from(ciphertext[1]).toString("hex"));

    console.log("\n========== ENCRYPTION SUMMARY ==========");
    console.log("60 -> enc(a)");
    console.log("9  -> enc(b)");

    const diffEventPromise = awaitEvent("diffEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const queueSig = await program.methods
      .subtract(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("subtract")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Queue sig is ", queueSig);

    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Finalize sig is ", finalizeSig);

    const diffEvent = await diffEventPromise;

    console.log("\n========== EVENT RECEIVED ==========");

    console.log("encrypted result raw =", diffEvent.diff);

    console.log(
      "encrypted result hex =",
      Buffer.from(diffEvent.diff).toString("hex")
    );

    console.log(
      "result nonce hex =",
      Buffer.from(diffEvent.nonce).toString("hex")
    );

    console.log("\n========== DECRYPTING RESULT ==========");

    const decrypted = cipher.decrypt([diffEvent.diff], diffEvent.nonce)[0];

    console.log("final decrypted result =", decrypted.toString());

    console.log("\n========== EXPECTED ==========");
    console.log(
      `${val1.toString()} - ${val2.toString()} = ${(val1 - val2).toString()}`
    );

    expect(decrypted).to.equal(val1 - val2);

    console.log("\n========== TEST PASSED ==========");
  });

  it("Multiply works!", async () => {
    // Step 1: Load the payer keypair from the local Solana wallet.
    // This is the account that will sign and pay for all transactions.
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    // Step 2: Initialize the computation definition for "multiply".
    // This registers the circuit on-chain so MXE knows how to execute it.
    console.log("Initializing multiply computation definition");
    const initMulSig = await initMultiplyCompDef(program, owner);
    console.log(
      "Multiply computation definition initialized with signature",
      initMulSig
    );

    // Step 3: Fetch the MXE's x25519 public key.
    // This is needed to establish a shared secret for encrypting inputs
    // and decrypting outputs. Retries because MXE may not be ready immediately.
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    console.log("MXE x25519 pubkey is", mxePublicKey);

    // Step 4: Generate an ephemeral x25519 keypair for this computation.
    // The private key stays client-side; the public key is sent on-chain
    // so MXE can derive the same shared secret for encrypting the result.
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);

    // Step 5: Derive the shared secret and create a cipher instance.
    // Both client and MXE derive the same secret via ECDH (x25519),
    // then use RescueCipher for symmetric encryption/decryption.
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Step 6: Define the plaintext inputs to multiply.
    const val1 = BigInt(7);
    const val2 = BigInt(8);

    console.log("\n========== PLAINTEXT INPUTS ==========");
    console.log("a =", val1.toString());
    console.log("b =", val2.toString());

    const plaintext = [val1, val2];

    console.log("\nPlaintext array:");
    console.log(plaintext.map((v) => v.toString()));

    // Step 7: Generate a random 16-byte nonce for encryption.
    // The nonce ensures each encryption produces a unique ciphertext,
    // even for the same plaintext and key.
    const nonce = randomBytes(16);

    console.log("\n========== NONCE ==========");
    console.log("nonce (hex) =", Buffer.from(nonce).toString("hex"));

    // Step 8: Encrypt the plaintext values using the shared cipher.
    // Each value becomes a 32-byte ciphertext that only MXE can process.
    const ciphertext = cipher.encrypt(plaintext, nonce);

    console.log("\n========== ENCRYPTED VALUES ==========");
    console.log("enc(a) raw bytes =", ciphertext[0]);
    console.log("enc(a) hex =", Buffer.from(ciphertext[0]).toString("hex"));
    console.log("enc(b) raw bytes =", ciphertext[1]);
    console.log("enc(b) hex =", Buffer.from(ciphertext[1]).toString("hex"));

    console.log("\n========== ENCRYPTION SUMMARY ==========");
    console.log(`${val1.toString()} -> enc(a)`);
    console.log(`${val2.toString()} -> enc(b)`);

    // Step 9: Set up an event listener BEFORE submitting the transaction.
    // The callback instruction emits a DiffEvent with the encrypted result.
    // We await this promise after finalization to capture the output.
    const mulEventPromise = awaitEvent("multiplyEvent");

    // Step 10: Generate a random computation offset.
    // This is a unique identifier for this specific computation instance,
    // used to derive the on-chain computation account PDA.
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    // Step 11: Submit the multiply instruction on-chain.
    // This queues the encrypted computation for MXE to process.
    // We pass: computation offset, two encrypted inputs, our public key, and the nonce.
    const queueSig = await program.methods
      .multiply(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString())
      )
      .accountsPartial({
        // Derive all required PDA accounts for the computation:
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(
          arciumEnv.arciumClusterOffset
        ),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("multiply")).readUInt32LE()
        ),
      })
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Queue sig is ", queueSig);

    // Step 12: Wait for MXE to pick up, execute, and finalize the computation.
    // This polls until the computation result is written on-chain.
    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Finalize sig is ", finalizeSig);

    // Step 13: Await the emitted event containing the encrypted result.
    const mulEvent = await mulEventPromise;

    console.log("\n========== EVENT RECEIVED ==========");
    console.log("encrypted result raw =", mulEvent.product);
    console.log(
      "encrypted result hex =",
      Buffer.from(mulEvent.product).toString("hex")
    );
    console.log(
      "result nonce hex =",
      Buffer.from(mulEvent.nonce).toString("hex")
    );

    // Step 14: Decrypt the result using the same shared cipher.
    // MXE encrypted the output with our shared secret, so we can decrypt it.
    console.log("\n========== DECRYPTING RESULT ==========");
    const decrypted = cipher.decrypt([mulEvent.product], mulEvent.nonce)[0];
    console.log("final decrypted result =", decrypted.toString());

    // Step 15: Assert the decrypted result matches the expected product.
    console.log("\n========== EXPECTED ==========");
    console.log(
      `${val1.toString()} * ${val2.toString()} = ${(val1 * val2).toString()}`
    );

    expect(decrypted).to.equal(val1 * val2);

    console.log("\n========== TEST PASSED ==========");
  });

  // --- Helper: Initialize the "add_together" computation definition ---
  async function initAddTogetherCompDef(
    program: Program<HelloWorld>,
    owner: anchor.web3.Keypair
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("add_together");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    console.log("Comp def pda is ", compDefPDA);

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot
    );

    const sig = await program.methods
      .initAddTogetherCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });
    console.log("Init add together computation definition transaction", sig);

    const rawCircuit = fs.readFileSync("build/add_together.arcis");
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      "add_together",
      program.programId,
      rawCircuit,
      true,
      500,
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );

    return sig;
  }

  async function initSubtractCompDef(
    program: Program<HelloWorld>,
    owner: anchor.web3.Keypair
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("subtract");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    console.log("Comp def pda is ", compDefPDA);

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot
    );

    const sig = await program.methods
      .initSubtractCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });
    console.log("Init subtract computation definition transaction", sig);

    const rawCircuit = fs.readFileSync("build/subtract.arcis");
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      "subtract",
      program.programId,
      rawCircuit,
      true,
      500,
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );

    return sig;
  }

  // --- Helper: Initialize the "multiply" computation definition ---
  // This follows the same pattern as initAddTogetherCompDef / initSubtractCompDef:
  //   1. Derive the PDA for the computation definition account
  //   2. Fetch the MXE account to get the lookup table address
  //   3. Call the init instruction to register the comp def on-chain
  //   4. Upload the compiled circuit binary so MXE can execute it
  async function initMultiplyCompDef(
    program: Program<HelloWorld>,
    owner: anchor.web3.Keypair
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("multiply");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    console.log("Comp def pda is ", compDefPDA);

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(
      program.programId,
      mxeAcc.lutOffsetSlot
    );

    const sig = await program.methods
      .initMultiplyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });
    console.log("Init multiply computation definition transaction", sig);

    const rawCircuit = fs.readFileSync("build/multiply.arcis");
    await uploadCircuit(
      provider as anchor.AnchorProvider,
      "multiply",
      program.programId,
      rawCircuit,
      true,
      500,
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );

    return sig;
  }
});

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString()))
  );
}
