import { runArkEmbeddingProbe } from "@/lib/rag/ark-embeddings";

async function main() {
  const result = await runArkEmbeddingProbe();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
