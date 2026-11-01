export async function cmdHook(..._a: unknown[]): Promise<number> {
  process.stderr.write("offload: not implemented yet\n");
  return 2;
}
