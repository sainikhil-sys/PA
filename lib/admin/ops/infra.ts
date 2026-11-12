import "server-only";
import { z } from "zod";
import { adminOp } from "../op";
import { runProbes } from "../probes";

/** Live infrastructure probes. Read only; the result holds fixed text and numbers, never secrets. */
export const infraProbesOp = adminOp({
  action: "infra.probe",
  resourceType: "infra",
  permission: "infra.read",
  kind: "read",
  input: z.object({}),
  run: async () => ({ probes: await runProbes() }),
});
