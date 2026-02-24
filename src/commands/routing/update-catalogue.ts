import { loadBenchmarkCatalogue } from "../../task-routing/catalogue/catalogue.js";

export async function routingUpdateCatalogueCommand(): Promise<void> {
  const catalogue = loadBenchmarkCatalogue();
  const modelCount = Object.keys(catalogue.models).length;

  console.log(`Catalogue version: ${catalogue.catalogueVersion}`);
  console.log(`Last updated:      ${catalogue.lastUpdated}`);
  console.log(`Models:            ${modelCount}`);
  console.log();
  console.log("Catalogue loaded successfully from shipped data.");
  console.log(
    "Live catalogue fetching (Artificial Analysis, Chatbot Arena) is planned for a future release.",
  );
}
