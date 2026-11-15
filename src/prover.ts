import * as path from "path";
import * as snarkjs from "snarkjs";
import type { Groth16Proof } from "./types";

/**
 * Local Groth16 proving with snarkjs fullProve against the downloaded
 * gatekeeper artifacts. Measured locally at ~0.3-1.0s per proof for this
 * circuit (647 witnesses), comfortably inside the 60s task deadline.
 */
export class Prover {
  private wasmPath: string;
  private zkeyPath: string;

  constructor(circuitsDir: string) {
    this.wasmPath = path.join(circuitsDir, "gatekeeper.wasm");
    this.zkeyPath = path.join(circuitsDir, "gatekeeper_final.zkey");
  }

  async prove(
    circuitInputs: Record<string, string>,
  ): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      this.wasmPath,
      this.zkeyPath,
    );
    return { proof: proof as Groth16Proof, publicSignals };
  }
}
