import { buildApp } from "./app.js";
import { resumeCampaigns } from "./lib/campaignSend.js";
import { config } from "./config.js";

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: config.PORT });
// Offer emails that were cut off by the last restart carry on now.
await resumeCampaigns(app.log).catch((err) => app.log.error({ err: (err as Error).message }, "could not resume campaigns"));
