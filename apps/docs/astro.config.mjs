// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// https://starlight.astro.build/reference/configuration/
export default defineConfig({
  integrations: [
    starlight({
      title: "SoroRail",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Sororail/sororail-frontend",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [{ label: "Getting started", slug: "getting-started" }],
        },
        {
          label: "Concepts",
          items: [{ autogenerate: { directory: "concepts" } }],
        },
      ],
    }),
  ],
});
