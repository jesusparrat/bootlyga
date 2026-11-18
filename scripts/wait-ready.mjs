const base = process.env.GATEWAY_URL ?? "http://127.0.0.1:8080";

async function waitReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/health/ready`);
      if (response.ok) return;
    } catch {
      // el gateway todavía arranca
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("el gateway no está listo");
}

await waitReady();
console.log("gateway listo");