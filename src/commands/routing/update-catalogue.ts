import { loadBenchmarkCatalogue } from "../../task-routing/catalogue/catalogue.js";

export type UpdateCatalogueCommandOptions = {
  check?: boolean;
};

/** Version manifest URL for checking catalogue updates. */
const VERSION_MANIFEST_URL =
  "https://raw.githubusercontent.com/openclaw/openclaw/main/src/task-routing/catalogue/benchmark-catalogue.json";

export async function routingUpdateCatalogueCommand(
  opts?: UpdateCatalogueCommandOptions,
): Promise<void> {
  const catalogue = loadBenchmarkCatalogue();
  const modelCount = Object.keys(catalogue.models).length;

  console.log(`Catalogue version: ${catalogue.catalogueVersion}`);
  console.log(`Last updated:      ${catalogue.lastUpdated}`);
  console.log(`Models:            ${modelCount}`);

  if (opts?.check) {
    console.log();
    await checkForUpdates(catalogue.catalogueVersion);
    return;
  }

  console.log();
  console.log("Catalogue loaded successfully from shipped data.");
  console.log("Run with --check to compare against the latest published version.");
  console.log(
    "Live catalogue fetching (Artificial Analysis, Chatbot Arena) is planned for a future release.",
  );
}

async function checkForUpdates(currentVersion: string): Promise<void> {
  console.log("Checking for updates...");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(VERSION_MANIFEST_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`Could not check for updates (HTTP ${response.status}).`);
      return;
    }

    const remote = (await response.json()) as { catalogueVersion?: string };
    if (!remote.catalogueVersion) {
      console.log("Remote manifest did not contain a version field.");
      return;
    }

    if (remote.catalogueVersion === currentVersion) {
      console.log(`Up to date (${currentVersion}).`);
    } else {
      console.log(`Update available: ${currentVersion} → ${remote.catalogueVersion}`);
      console.log("Update your openclaw installation to get the latest catalogue.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Could not check for updates: ${message}`);
  }
}
